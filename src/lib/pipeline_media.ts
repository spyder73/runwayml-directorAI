import type Database from 'better-sqlite3';
import { getAudioDurationInSeconds } from 'get-audio-duration';
import path from 'path';
import db from './db';
import { renderFinalFilm } from './final-render';
import {
  completeMediaTask,
  failMediaTask,
  markMediaTaskRunning,
  selectRunnableMediaTasks,
  type MediaTaskKind,
  type MediaTaskRow,
} from './media-tasks';
import { ensureSafePrompt } from './moderation';
import { canRenderFinal } from './pipeline-guards';
import { FINAL_IMAGE_QUALITY } from './production-config';
import { parseReferenceAssetIds, prepareSceneReferences } from './production-references';
import { assertRunwayImagePrompt, assertRunwayVideoPrompt, ensureRunwayVideoPromptMotion } from './prompt-lint';
import {
  generateImageAsset,
  generateSpeechAsset,
  generateVideoAsset,
  imageRatio,
  loadReferenceImage,
  videoRatio,
  type RunwayReferenceImage,
} from './runway';
import { planShots } from './shot_planner';
import { broadcastSessionUpdate } from './sse';
import type { ReferenceAssetRow, SceneRow, SessionRow } from './types';

type SqliteDatabase = Database.Database;

export type MediaTaskExecutor = (params: {
  database: SqliteDatabase;
  task: MediaTaskRow;
  session: SessionRow;
}) => Promise<string | undefined | void>;

export type MediaTaskExecutors = Partial<Record<MediaTaskKind, MediaTaskExecutor>>;

export type MediaTaskRunnerResult = {
  started: number;
  succeeded: number;
  failed: number;
  remainingQueued: number;
};

export type MediaTaskConcurrencyMode = 'serial' | 'parallel';

export type MediaTaskRunnerOptions = {
  database?: SqliteDatabase;
  includeRender?: boolean;
  onlyKinds?: MediaTaskKind[];
  completionMode?: 'all' | 'frames' | 'final_assets';
  concurrencyMode?: MediaTaskConcurrencyMode;
  executors?: MediaTaskExecutors;
  maxCycles?: number;
  batchLimit?: number;
};

const PRODUCTION_TASK_KINDS: MediaTaskKind[] = [
  'generate_scene_frame',
  'generate_narration',
  'generate_video_shot',
];

const DEFAULT_KIND_CONCURRENCY: Record<MediaTaskKind, number> = {
  vision_describe_upload: 1,
  generate_sketch: 1,
  generate_scene_frame: 3,
  generate_narration: 3,
  generate_video_shot: 2,
  render_final: 1,
};

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getSession(database: SqliteDatabase, sessionId: string) {
  return database.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
}

function getScenes(database: SqliteDatabase, sessionId: string) {
  return database.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
}

function getScene(database: SqliteDatabase, sceneId: string | null) {
  if (!sceneId) return undefined;
  return database.prepare('SELECT * FROM scenes WHERE id = ?').get(sceneId) as SceneRow | undefined;
}

function sceneShowsProtagonist(scene: SceneRow) {
  return scene.is_protagonist_visible === 1 || scene.is_protagonist_visible === true;
}

async function loadReferenceImages(assets: Array<Pick<ReferenceAssetRow, 'runway_uri' | 'local_url' | 'stable_tag'>>) {
  const referenceImages: RunwayReferenceImage[] = [];

  for (const asset of assets.slice(0, 16)) {
    try {
      if (asset.runway_uri) {
        referenceImages.push({ uri: asset.runway_uri, tag: asset.stable_tag });
      } else if (asset.local_url) {
        referenceImages.push(await loadReferenceImage(asset.local_url, asset.stable_tag));
      }
    } catch (error) {
      console.error(`Failed to load reference image ${asset.local_url || asset.runway_uri}:`, error);
    }
  }

  return referenceImages;
}

function broadcastProgress(database: SqliteDatabase, sessionId: string, error?: string) {
  broadcastSessionUpdate(sessionId, {
    session: getSession(database, sessionId),
    scenes: getScenes(database, sessionId),
    ...(error ? { error } : {}),
  });
}

function setSessionStatus(database: SqliteDatabase, sessionId: string, status: SessionRow['status'], finalVideoUrl?: string | null) {
  if (typeof finalVideoUrl === 'string' || finalVideoUrl === null) {
    database.prepare(`
      UPDATE sessions
      SET status = ?, final_video_url = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, finalVideoUrl, sessionId);
    return;
  }

  database.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(status, sessionId);
}

function runnableKinds(includeRender: boolean, onlyKinds?: MediaTaskKind[]) {
  if (onlyKinds?.length) return new Set<MediaTaskKind>(onlyKinds);
  return new Set<MediaTaskKind>(includeRender ? [...PRODUCTION_TASK_KINDS, 'render_final'] : PRODUCTION_TASK_KINDS);
}

function mediaTaskConcurrencyMode(override?: MediaTaskConcurrencyMode): MediaTaskConcurrencyMode {
  if (override) return override;
  return process.env.RUNWAY_MEDIA_CONCURRENCY === 'parallel' ? 'parallel' : 'serial';
}

function selectTaskBatch(
  tasks: MediaTaskRow[],
  allowedKinds: Set<MediaTaskKind>,
  concurrencyMode: MediaTaskConcurrencyMode,
) {
  if (concurrencyMode === 'serial') {
    const task = tasks.find((candidate) => allowedKinds.has(candidate.kind));
    return task ? [task] : [];
  }

  const counts = new Map<MediaTaskKind, number>();
  const batch: MediaTaskRow[] = [];

  for (const task of tasks) {
    if (!allowedKinds.has(task.kind)) continue;

    const current = counts.get(task.kind) || 0;
    if (current >= DEFAULT_KIND_CONCURRENCY[task.kind]) continue;

    counts.set(task.kind, current + 1);
    batch.push(task);
  }

  return batch;
}

function countRemainingQueued(database: SqliteDatabase, sessionId: string, allowedKinds: Set<MediaTaskKind>) {
  const runnable = selectRunnableMediaTasks(database, sessionId, 1000);
  return runnable.filter((task) => allowedKinds.has(task.kind)).length;
}

function syncSessionProgress(
  database: SqliteDatabase,
  sessionId: string,
  includeRender: boolean,
  completionMode: MediaTaskRunnerOptions['completionMode'] = 'all',
) {
  const session = getSession(database, sessionId);
  if (!session || session.status === 'COMPLETED') return;

  const tasks = (database.prepare('SELECT * FROM media_tasks WHERE session_id = ?').all(sessionId) as MediaTaskRow[])
    .filter((task) => task.kind === 'render_final' || PRODUCTION_TASK_KINDS.includes(task.kind));
  if (!tasks.length) return;
  if (tasks.some((task) => task.status === 'failed')) {
    setSessionStatus(database, sessionId, 'FAILED');
    return;
  }

  const frameTasks = tasks.filter((task) => task.kind === 'generate_scene_frame');
  const mediaTasks = tasks.filter((task) => task.kind === 'generate_narration' || task.kind === 'generate_video_shot');
  const renderTask = tasks.find((task) => task.kind === 'render_final');

  if (frameTasks.some((task) => task.status !== 'succeeded')) {
    setSessionStatus(database, sessionId, 'GENERATING_IMAGES');
    return;
  }

  if (completionMode === 'frames') {
    setSessionStatus(database, sessionId, 'AWAITING_APPROVAL');
    return;
  }

  if (mediaTasks.some((task) => task.status !== 'succeeded')) {
    setSessionStatus(database, sessionId, 'GENERATING_FINAL_ASSETS');
    return;
  }

  if (!includeRender || renderTask?.status === 'queued') {
    setSessionStatus(database, sessionId, 'PREVIEW_READY');
  }
}

function markSceneFailure(database: SqliteDatabase, task: MediaTaskRow, error: string) {
  if (!task.scene_id) return;

  const statusByKind: Partial<Record<MediaTaskKind, string>> = {
    generate_scene_frame: 'image_failed',
    generate_narration: 'audio_failed',
    generate_video_shot: 'video_failed',
  };
  const sceneStatus = statusByKind[task.kind] || 'failed';

  database.prepare(`
    UPDATE scenes
    SET status = ?,
        retry_attempts = COALESCE(retry_attempts, 0) + 1,
        last_failure = ?
    WHERE id = ?
  `).run(sceneStatus, error, task.scene_id);
}

async function executeFrameTask(params: { database: SqliteDatabase; task: MediaTaskRow; session: SessionRow }) {
  const { database, task, session } = params;
  const scene = getScene(database, task.scene_id);
  if (!scene) {
    throw new Error(`Scene not found for media task ${task.id}`);
  }

  if (scene.reference_image_url && scene.status !== 'image_failed') {
    database.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?')
      .run('awaiting_approval', scene.id);
    broadcastProgress(database, session.id);
    return scene.reference_image_url;
  }

  database.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?')
    .run('generating_image', scene.id);
  setSessionStatus(database, session.id, 'GENERATING_IMAGES');
  broadcastProgress(database, session.id);

  const referenceAssets = database.prepare('SELECT * FROM reference_assets WHERE session_id = ? ORDER BY created_at ASC')
    .all(session.id) as ReferenceAssetRow[];
  const preparedReferences = prepareSceneReferences({
    promptText: scene.image_prompt || scene.visual_prompt,
    sceneReferenceAssetIds: parseReferenceAssetIds(scene.scene_references),
    protagonistVisible: sceneShowsProtagonist(scene),
    assets: referenceAssets,
  });
  const promptText = await ensureSafePrompt(preparedReferences.promptText);

  assertRunwayImagePrompt({
    promptText,
    referenceImages: preparedReferences.referenceImages,
  });

  const referenceImages = await loadReferenceImages(preparedReferences.selectedAssets);
  const imageAsset = await generateImageAsset({
    promptText,
    quality: FINAL_IMAGE_QUALITY,
    ratio: imageRatio(session.aspect_ratio),
    referenceImages: referenceImages.length ? referenceImages : undefined,
    sessionId: session.id,
  });

  database.prepare(`
    UPDATE scenes
    SET reference_image_url = ?,
        reference_tags = ?,
        status = ?,
        last_failure = NULL
    WHERE id = ?
  `).run(
    imageAsset.localUrl,
    JSON.stringify(preparedReferences.selectedAssets.map((asset) => asset.stable_tag)),
    'awaiting_approval',
    scene.id,
  );
  broadcastProgress(database, session.id);

  return imageAsset.localUrl;
}

async function executeNarrationTask(params: { database: SqliteDatabase; task: MediaTaskRow; session: SessionRow }) {
  const { database, task, session } = params;
  const scene = getScene(database, task.scene_id);
  if (!scene) {
    throw new Error(`Scene not found for media task ${task.id}`);
  }

  if (scene.audio_url && scene.status !== 'audio_failed') {
    database.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?')
      .run(scene.video_url ? 'completed' : 'audio_ready', scene.id);
    broadcastProgress(database, session.id);
    return scene.audio_url;
  }

  database.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?')
    .run('generating_audio', scene.id);
  setSessionStatus(database, session.id, 'GENERATING_FINAL_ASSETS');
  broadcastProgress(database, session.id);

  const audioAsset = await generateSpeechAsset({
    promptText: scene.narrator_text,
    sessionId: session.id,
  });

  let exactDuration = scene.duration || 5;
  try {
    exactDuration = await getAudioDurationInSeconds(path.join(process.cwd(), 'public', audioAsset.filePath));
  } catch (error) {
    console.error('Could not get audio duration:', error);
  }

  database.prepare(`
    UPDATE scenes
    SET audio_url = ?,
        duration = ?,
        status = ?,
        last_failure = NULL
    WHERE id = ?
  `).run(audioAsset.localUrl, Math.ceil(exactDuration), 'audio_ready', scene.id);
  broadcastProgress(database, session.id);

  return audioAsset.localUrl;
}

async function executeVideoTask(params: { database: SqliteDatabase; task: MediaTaskRow; session: SessionRow }) {
  const { database, task, session } = params;
  const scene = getScene(database, task.scene_id);
  if (!scene) {
    throw new Error(`Scene not found for media task ${task.id}`);
  }

  if (scene.video_url && scene.status !== 'video_failed') {
    database.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?')
      .run('completed', scene.id);
    broadcastProgress(database, session.id);
    return scene.video_url;
  }

  if (!scene.reference_image_url) {
    throw new Error(`Scene ${scene.scene_index + 1} is missing its generated reference image.`);
  }

  database.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?')
    .run('generating_video', scene.id);
  setSessionStatus(database, session.id, 'GENERATING_FINAL_ASSETS');
  broadcastProgress(database, session.id);

  const exactDuration = scene.duration || 5;
  const shots = await planShots(scene.video_prompt || scene.visual_prompt, exactDuration);
  const videoUrls: string[] = [];
  const shotPlan: Array<{ duration: number; prompt: string; url: string }> = [];

  for (const shot of shots) {
    const safePrompt = ensureRunwayVideoPromptMotion(await ensureSafePrompt(shot.prompt));
    assertRunwayVideoPrompt({
      promptText: safePrompt,
      durationSeconds: shot.duration,
    });
    const videoAsset = await generateVideoAsset({
      promptImageUrl: scene.reference_image_url,
      promptText: safePrompt,
      ratio: videoRatio(session.aspect_ratio),
      duration: shot.duration,
      sessionId: session.id,
    });
    videoUrls.push(videoAsset.localUrl);
    shotPlan.push({
      duration: shot.duration,
      prompt: safePrompt,
      url: videoAsset.localUrl,
    });
  }

  const outputAssetId = JSON.stringify(videoUrls);

  database.prepare(`
    UPDATE scenes
    SET video_url = ?,
        shot_plan_json = ?,
        duration = ?,
        status = ?,
        last_failure = NULL
    WHERE id = ?
  `).run(outputAssetId, JSON.stringify(shotPlan), Math.ceil(exactDuration), 'completed', scene.id);
  broadcastProgress(database, session.id);

  return outputAssetId;
}

async function executeRenderTask(params: { database: SqliteDatabase; task: MediaTaskRow; session: SessionRow }) {
  const { database, session } = params;

  if (session.final_video_url && session.status === 'COMPLETED') {
    return session.final_video_url;
  }

  setSessionStatus(database, session.id, 'RENDERING', null);
  broadcastProgress(database, session.id);

  const scenes = getScenes(database, session.id);
  const renderGuard = canRenderFinal({
    scenes: scenes.map((scene) => ({
      videoUrl: scene.video_url,
    })),
  });
  if (!renderGuard.allowed) {
    throw new Error(`Final render is not ready: ${renderGuard.reasons.join('; ')}`);
  }

  const rendered = await renderFinalFilm({
    sessionId: session.id,
    aspectRatio: session.aspect_ratio,
    scenes,
  });

  setSessionStatus(database, session.id, 'COMPLETED', rendered.publicUrl);
  broadcastProgress(database, session.id);

  return rendered.publicUrl;
}

const DEFAULT_EXECUTORS: MediaTaskExecutors = {
  generate_scene_frame: executeFrameTask,
  generate_narration: executeNarrationTask,
  generate_video_shot: executeVideoTask,
  render_final: executeRenderTask,
};

async function runOneTask(params: {
  database: SqliteDatabase;
  task: MediaTaskRow;
  executors: MediaTaskExecutors;
}) {
  const { database, task, executors } = params;
  const session = getSession(database, task.session_id);
  if (!session) {
    throw new Error(`Session not found for media task ${task.id}`);
  }

  const executor = executors[task.kind];
  if (!executor) {
    throw new Error(`No media task executor registered for ${task.kind}.`);
  }

  markMediaTaskRunning(database, task.id);

  try {
    const outputAssetId = await executor({ database, task, session });
    completeMediaTask(database, task.id, typeof outputAssetId === 'string' ? outputAssetId : undefined);
    return { ok: true as const };
  } catch (error) {
    const message = formatError(error);
    failMediaTask(database, task.id, message);
    markSceneFailure(database, task, message);
    setSessionStatus(database, task.session_id, 'FAILED');
    broadcastProgress(database, task.session_id, message);
    return { ok: false as const, error };
  }
}

export async function runMediaTaskRunner(sessionId: string, options: MediaTaskRunnerOptions = {}): Promise<MediaTaskRunnerResult> {
  const database = options.database || db;
  const allowedKinds = runnableKinds(Boolean(options.includeRender), options.onlyKinds);
  const concurrencyMode = mediaTaskConcurrencyMode(options.concurrencyMode);
  const executors = { ...DEFAULT_EXECUTORS, ...(options.executors || {}) };
  const result: MediaTaskRunnerResult = {
    started: 0,
    succeeded: 0,
    failed: 0,
    remainingQueued: 0,
  };
  const maxCycles = options.maxCycles || 100;
  const batchLimit = options.batchLimit || 100;

  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    const runnable = selectRunnableMediaTasks(database, sessionId, batchLimit);
    const batch = selectTaskBatch(runnable, allowedKinds, concurrencyMode);

    if (!batch.length) {
      syncSessionProgress(database, sessionId, Boolean(options.includeRender), options.completionMode);
      broadcastProgress(database, sessionId);
      result.remainingQueued = countRemainingQueued(database, sessionId, allowedKinds);
      return result;
    }

    result.started += batch.length;
    const outcomes = await Promise.all(batch.map((task) => runOneTask({ database, task, executors })));

    for (const outcome of outcomes) {
      if (outcome.ok) {
        result.succeeded += 1;
      } else {
        result.failed += 1;
      }
    }

    if (outcomes.some((outcome) => !outcome.ok)) {
      const firstFailure = outcomes.find((outcome) => !outcome.ok);
      result.remainingQueued = countRemainingQueued(database, sessionId, allowedKinds);
      throw firstFailure?.error instanceof Error ? firstFailure.error : new Error('Media task runner failed.');
    }

    syncSessionProgress(database, sessionId, Boolean(options.includeRender), options.completionMode);
    broadcastProgress(database, sessionId);
  }

  result.remainingQueued = countRemainingQueued(database, sessionId, allowedKinds);
  if (result.remainingQueued > 0) {
    throw new Error(`Media task runner stopped after ${maxCycles} cycles with ${result.remainingQueued} runnable tasks remaining.`);
  }
  return result;
}

export async function runMediaGenerationPhase(sessionId: string) {
  return runMediaTaskRunner(sessionId, {
    includeRender: false,
    onlyKinds: PRODUCTION_TASK_KINDS,
    completionMode: 'all',
  });
}

export async function runFrameGenerationPhase(sessionId: string, options: Omit<MediaTaskRunnerOptions, 'includeRender' | 'onlyKinds' | 'completionMode'> = {}) {
  return runMediaTaskRunner(sessionId, {
    ...options,
    includeRender: false,
    onlyKinds: ['generate_scene_frame'],
    completionMode: 'frames',
  });
}

export async function runFinalAssetsPhase(sessionId: string, options: Omit<MediaTaskRunnerOptions, 'includeRender' | 'onlyKinds' | 'completionMode'> = {}) {
  const database = options.database || db;
  setSessionStatus(database, sessionId, 'GENERATING_FINAL_ASSETS');
  broadcastProgress(database, sessionId);

  return runMediaTaskRunner(sessionId, {
    ...options,
    includeRender: false,
    onlyKinds: ['generate_narration', 'generate_video_shot'],
    completionMode: 'final_assets',
  });
}

export async function runFinalRenderPhase(sessionId: string) {
  return runMediaTaskRunner(sessionId, {
    includeRender: true,
    onlyKinds: ['render_final'],
  });
}
