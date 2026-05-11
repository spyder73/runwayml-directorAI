import type Database from 'better-sqlite3';
import path from 'path';
import db from './db';
import type { FinalRenderProgress } from './final-render';
import {
  completeMediaTask,
  failMediaTask,
  getRenderProgressForSession,
  markMediaTaskRunning,
  selectRunnableMediaTasks,
  type MediaTaskKind,
  type MediaTaskRow,
  updateRenderProgressForSession,
} from './media-tasks';
import { ensureSafePrompt } from './moderation';
import { canRenderFinal } from './pipeline-guards';
import { FINAL_IMAGE_QUALITY } from './production-config';
import { parseReferenceAssetIds, prepareSceneReferences } from './production-references';
import { assertRunwayImagePrompt, assertRunwayVideoPrompt, ensureRunwayVideoPromptMotion } from './prompt-lint';
import { logMediaGeneration, type MediaGenerationLogDetails } from './media-logging';
import { repairRunwayVideoPromptForValidation } from './video-prompt-repair';
import {
  generateImageAsset,
  generateSpeechAsset,
  generateVideoAsset,
  imageRatio,
  loadReferenceImage,
  videoRatio,
  type RunwayClient,
  type RunwayReferenceImage,
} from './runway';
import { cleanGeneratorPrompt, planShots, referencePromptFromGeneratorText, type ShotPlan } from './shot_planner';
import { broadcastSessionUpdate } from './sse';
import type { ReferenceAssetRow, SceneRow, SessionRow, StoryEntityRow } from './types';
import { notifyFinalRenderReady } from './final-render-notification';
import {
  createRunwayClientForSession,
  getRunwayConcurrencyModeForSession,
  getRunwayVideoModelForSession,
  requireOpenRouterApiKeyForSession,
  safeCredentialErrorMessage,
} from './providers/user-credentials';

type SqliteDatabase = Database.Database;

const externalImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

async function getAudioDurationInSeconds(audioPath: string) {
  const { getAudioDurationInSeconds: readAudioDuration } = await externalImport<typeof import('get-audio-duration')>('get-audio-duration');
  return readAudioDuration(audioPath);
}

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

const OPENING_FRAME_REFERENCE_TAG = 'opening_frame';

export type ShotPlanProgress = {
  duration: number;
  prompt: string;
  url?: string;
  reference_image_url?: string;
  reference_prompt?: string;
  visual_start_state?: string;
  visual_end_state?: string;
  camera_role?: string;
  angle_change_reason?: string;
  status?: 'pending' | 'running' | 'succeeded' | 'failed';
  last_error?: string;
};

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mediaTaskLogContext(session: SessionRow, task: MediaTaskRow, scene?: SceneRow): MediaGenerationLogDetails {
  return {
    sessionId: session.id,
    taskId: task.id,
    kind: task.kind,
    sceneId: scene?.id || task.scene_id,
    sceneIndex: typeof scene?.scene_index === 'number' ? scene.scene_index + 1 : null,
  };
}

function parseShotPlanProgress(value: string | null | undefined): ShotPlanProgress[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        duration: Number(item.duration) || 2,
        prompt: typeof item.prompt === 'string' ? item.prompt : '',
        ...(typeof item.url === 'string' && item.url.trim() ? { url: item.url } : {}),
        ...(typeof item.reference_image_url === 'string' && item.reference_image_url.trim() ? { reference_image_url: item.reference_image_url } : {}),
        ...(typeof item.reference_prompt === 'string' && item.reference_prompt.trim() ? { reference_prompt: item.reference_prompt } : {}),
        ...(nonEmptyString(item.visual_start_state) ? { visual_start_state: nonEmptyString(item.visual_start_state) } : {}),
        ...(nonEmptyString(item.visual_end_state) ? { visual_end_state: nonEmptyString(item.visual_end_state) } : {}),
        ...(nonEmptyString(item.camera_role) ? { camera_role: nonEmptyString(item.camera_role) } : {}),
        ...(nonEmptyString(item.angle_change_reason) ? { angle_change_reason: nonEmptyString(item.angle_change_reason) } : {}),
        ...(item.status === 'running' || item.status === 'succeeded' || item.status === 'failed' ? { status: item.status } : {}),
        ...(typeof item.last_error === 'string' && item.last_error.trim() ? { last_error: item.last_error } : {}),
      }));
  } catch {
    return [];
  }
}

export function mergeShotPlanProgress(existingJson: string | null | undefined, plannedShots: ShotPlan[]): ShotPlanProgress[] {
  const existing = parseShotPlanProgress(existingJson);

  return plannedShots.map((shot, index) => {
    const previous = existing[index];
    const prompt = shot.prompt.trim();
    const referencePrompt = shot.referencePrompt?.trim();
    const canReuseGeneratedMedia = previous?.prompt === prompt;

    return {
      duration: shot.duration,
      prompt,
      ...(canReuseGeneratedMedia && previous?.url ? { url: previous.url } : {}),
      ...(canReuseGeneratedMedia && previous?.reference_image_url ? { reference_image_url: previous.reference_image_url } : {}),
      ...(referencePrompt ? { reference_prompt: referencePrompt } : previous?.reference_prompt ? { reference_prompt: previous.reference_prompt } : {}),
      ...(shot.visualStartState ? { visual_start_state: shot.visualStartState } : previous?.visual_start_state ? { visual_start_state: previous.visual_start_state } : {}),
      ...(shot.visualEndState ? { visual_end_state: shot.visualEndState } : previous?.visual_end_state ? { visual_end_state: previous.visual_end_state } : {}),
      ...(shot.cameraRole ? { camera_role: shot.cameraRole } : previous?.camera_role ? { camera_role: previous.camera_role } : {}),
      ...(shot.angleChangeReason ? { angle_change_reason: shot.angleChangeReason } : previous?.angle_change_reason ? { angle_change_reason: previous.angle_change_reason } : {}),
      status: canReuseGeneratedMedia && previous?.url ? 'succeeded' : 'pending',
    };
  });
}

export function shotPlanVideoUrls(shotPlan: ShotPlanProgress[]) {
  if (!shotPlan.length || shotPlan.some((shot) => !shot.url)) return [];
  return shotPlan.map((shot) => shot.url as string);
}

export function updateShotPlanPromptJson(
  existingJson: string | null | undefined,
  shotIndex: number,
  input: { prompt: string; referencePrompt?: string },
) {
  const existing = parseShotPlanProgress(existingJson);
  if (shotIndex < 0 || shotIndex >= existing.length) {
    throw new Error(`Sub-scene ${shotIndex + 1} is not available for this scene.`);
  }

  const nextPrompt = cleanGeneratorPrompt(input.prompt);
  const nextReferencePrompt = cleanGeneratorPrompt(input.referencePrompt) || nextPrompt;

  const updated = existing.map((shot, index) => {
    if (index !== shotIndex) return shot;
    return {
      duration: shot.duration,
      prompt: nextPrompt,
      reference_prompt: nextReferencePrompt,
      status: 'pending' as const,
    };
  });

  return JSON.stringify(updated);
}

function writeShotPlanProgress(database: SqliteDatabase, sceneId: string, shotPlan: ShotPlanProgress[], sessionId?: string) {
  database.prepare('UPDATE scenes SET shot_plan_json = ? WHERE id = ?')
    .run(JSON.stringify(shotPlan), sceneId);
  if (sessionId) broadcastProgress(database, sessionId);
}

async function loadReferenceImages(database: SqliteDatabase, assets: Array<Pick<ReferenceAssetRow, 'runway_uri' | 'local_url' | 'stable_tag'>>) {
  const referenceImages: RunwayReferenceImage[] = [];

  for (const asset of assets.slice(0, 16)) {
    try {
      if (asset.runway_uri) {
        referenceImages.push({ uri: asset.runway_uri, tag: asset.stable_tag });
      } else if (asset.local_url) {
        referenceImages.push(await loadReferenceImage(asset.local_url, asset.stable_tag, database));
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
    render_progress: getRenderProgressForSession(database, sessionId),
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

function persistRenderProgress(database: SqliteDatabase, sessionId: string, progress: FinalRenderProgress) {
  try {
    updateRenderProgressForSession(database, sessionId, {
      progress: progress.progress,
      message: progress.message,
      detail: {
        renderedFrames: progress.renderedFrames,
        encodedFrames: progress.encodedFrames,
        totalFrames: progress.totalFrames,
        stitchStage: progress.stitchStage,
      },
    });
    broadcastProgress(database, sessionId);
  } catch (error) {
    console.error('Failed to persist render progress', error);
  }
}

function completeRenderProgress(database: SqliteDatabase, sessionId: string) {
  const current = getRenderProgressForSession(database, sessionId);
  persistRenderProgress(database, sessionId, {
    progress: 1,
    message: 'Final video ready',
    renderedFrames: current?.renderedFrames ?? null,
    encodedFrames: current?.encodedFrames ?? null,
    totalFrames: current?.totalFrames ?? null,
    stitchStage: current?.stitchStage ?? null,
  });
}

function runnableKinds(includeRender: boolean, onlyKinds?: MediaTaskKind[]) {
  if (onlyKinds?.length) return new Set<MediaTaskKind>(onlyKinds);
  return new Set<MediaTaskKind>(includeRender ? [...PRODUCTION_TASK_KINDS, 'render_final'] : PRODUCTION_TASK_KINDS);
}

function mediaTaskConcurrencyMode(database: SqliteDatabase, sessionId: string, override?: MediaTaskConcurrencyMode): MediaTaskConcurrencyMode {
  if (override) return override;
  return getRunwayConcurrencyModeForSession(database, sessionId);
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

  if (includeRender && renderTask?.status === 'succeeded') {
    setSessionStatus(database, sessionId, 'COMPLETED', renderTask.output_asset_id || session.final_video_url || null);
    return;
  }

  if (includeRender && renderTask?.status === 'running') {
    setSessionStatus(database, sessionId, 'RENDERING');
    return;
  }

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
    logMediaGeneration('scene_frame_reused_existing', {
      ...mediaTaskLogContext(session, task, scene),
      mediaType: 'image',
      localUrl: scene.reference_image_url,
    });
    database.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?')
      .run('awaiting_approval', scene.id);
    broadcastProgress(database, session.id);
    return scene.reference_image_url;
  }

  database.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?')
    .run('generating_image', scene.id);
  setSessionStatus(database, session.id, 'GENERATING_IMAGES');
  broadcastProgress(database, session.id);
  logMediaGeneration('scene_frame_generation_start', {
    ...mediaTaskLogContext(session, task, scene),
    mediaType: 'image',
    promptText: scene.image_prompt || scene.visual_prompt,
  });
  const openrouterApiKey = requireOpenRouterApiKeyForSession(database, session);
  const runwayClient = createRunwayClientForSession(database, session);

  const referenceAssets = database.prepare('SELECT * FROM reference_assets WHERE session_id = ? ORDER BY created_at ASC')
    .all(session.id) as ReferenceAssetRow[];
  const storyEntities = database.prepare('SELECT * FROM story_entities WHERE session_id = ? ORDER BY created_at ASC')
    .all(session.id) as StoryEntityRow[];
  const preparedReferences = prepareSceneReferences({
    promptText: scene.image_prompt || scene.visual_prompt,
    sceneReferenceAssetIds: parseReferenceAssetIds(scene.scene_references),
    protagonistVisible: sceneShowsProtagonist(scene),
    assets: referenceAssets,
    entities: storyEntities,
  });
  const promptText = await ensureSafePrompt(preparedReferences.promptText, { openrouterApiKey });

  assertRunwayImagePrompt({
    promptText,
    referenceImages: preparedReferences.referenceImages,
  });

  const referenceImages = await loadReferenceImages(database, preparedReferences.selectedAssets);
  const imageAsset = await generateImageAsset({
    promptText,
    quality: FINAL_IMAGE_QUALITY,
    ratio: imageRatio(session.aspect_ratio),
    referenceImages: referenceImages.length ? referenceImages : undefined,
    sessionId: session.id,
    runwayClient,
    database,
    logContext: mediaTaskLogContext(session, task, scene),
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
  logMediaGeneration('scene_frame_db_updated', {
    ...mediaTaskLogContext(session, task, scene),
    mediaType: 'image',
    localUrl: imageAsset.localUrl,
    referenceImageCount: preparedReferences.selectedAssets.length,
  });
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
  const runwayClient = createRunwayClientForSession(database, session);

  const audioAsset = await generateSpeechAsset({
    promptText: scene.narrator_text,
    sessionId: session.id,
    runwayClient,
    database,
    logContext: mediaTaskLogContext(session, task, scene),
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

export function buildContinuityReferencePrompt(shot: ShotPlan, shotIndex: number) {
  const basePrompt = cleanGeneratorPrompt(shot.referencePrompt)
    || referencePromptFromGeneratorText(shot.prompt)
    || cleanGeneratorPrompt(shot.visualStartState)
    || cleanGeneratorPrompt(shot.prompt);
  if (shotIndex === 0 || basePrompt.includes(`@${OPENING_FRAME_REFERENCE_TAG}`)) {
    return basePrompt;
  }
  return `Using @${OPENING_FRAME_REFERENCE_TAG} as the visual reference, ${basePrompt}`;
}

async function generateContinuityReferenceImage(params: {
  session: SessionRow;
  task: MediaTaskRow;
  scene: SceneRow;
  shot: ShotPlan;
  shotIndex: number;
  shotCount: number;
  openingReferenceImageUrl: string;
  openrouterApiKey: string;
  runwayClient: RunwayClient;
  database: SqliteDatabase;
}) {
  const logContext = {
    ...mediaTaskLogContext(params.session, params.task, params.scene),
    mediaType: 'image' as const,
    shotIndex: params.shotIndex + 1,
    shotCount: params.shotCount,
  };
  logMediaGeneration('continuity_frame_generation_start', {
    ...logContext,
    promptImageUrl: params.openingReferenceImageUrl,
    promptText: params.shot.referencePrompt || params.shot.prompt,
  });
  const openingReference = await loadReferenceImage(params.openingReferenceImageUrl, OPENING_FRAME_REFERENCE_TAG, params.database);
  const promptText = await ensureSafePrompt(buildContinuityReferencePrompt(params.shot, params.shotIndex), {
    openrouterApiKey: params.openrouterApiKey,
  });

  assertRunwayImagePrompt({
    promptText,
    referenceImages: [openingReference],
  });

  const imageAsset = await generateImageAsset({
    promptText,
    quality: FINAL_IMAGE_QUALITY,
    ratio: imageRatio(params.session.aspect_ratio),
    referenceImages: [openingReference],
    sessionId: params.session.id,
    runwayClient: params.runwayClient,
    database: params.database,
    logContext,
  });

  logMediaGeneration('continuity_frame_generated', {
    ...logContext,
    localUrl: imageAsset.localUrl,
    promptText,
  });

  return {
    promptText,
    localUrl: imageAsset.localUrl,
  };
}

async function executeVideoTask(params: { database: SqliteDatabase; task: MediaTaskRow; session: SessionRow }) {
  const { database, task, session } = params;
  const scene = getScene(database, task.scene_id);
  if (!scene) {
    throw new Error(`Scene not found for media task ${task.id}`);
  }

  if (scene.video_url && scene.status !== 'video_failed') {
    logMediaGeneration('scene_video_reused_existing', {
      ...mediaTaskLogContext(session, task, scene),
      mediaType: 'video',
      localUrl: scene.video_url,
    });
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
  logMediaGeneration('scene_video_generation_start', {
    ...mediaTaskLogContext(session, task, scene),
    mediaType: 'video',
    promptText: scene.video_prompt || scene.visual_prompt,
    promptImageUrl: scene.reference_image_url,
  });
  const openrouterApiKey = requireOpenRouterApiKeyForSession(database, session);
  const runwayClient = createRunwayClientForSession(database, session);

  const exactDuration = scene.duration || 5;
  const existingShotPlan = parseShotPlanProgress(scene.shot_plan_json);
  const reusablePlannedShots = existingShotPlan.filter((shot) => shot.prompt.trim()).map((shot) => ({
    duration: shot.duration,
    prompt: shot.prompt,
    ...(shot.reference_prompt ? { referencePrompt: shot.reference_prompt } : {}),
    ...(shot.visual_start_state ? { visualStartState: shot.visual_start_state } : {}),
    ...(shot.visual_end_state ? { visualEndState: shot.visual_end_state } : {}),
    ...(shot.camera_role ? { cameraRole: shot.camera_role } : {}),
    ...(shot.angle_change_reason ? { angleChangeReason: shot.angle_change_reason } : {}),
  }));
  const shots = reusablePlannedShots.length
    ? reusablePlannedShots
    : await planShots(scene.video_prompt || scene.visual_prompt, exactDuration, { openrouterApiKey });
  logMediaGeneration('scene_video_shots_planned', {
    ...mediaTaskLogContext(session, task, scene),
    mediaType: 'video',
    duration: exactDuration,
    shotCount: shots.length,
    promptText: scene.video_prompt || scene.visual_prompt,
  });
  const shotPlan = mergeShotPlanProgress(scene.shot_plan_json, shots);
  writeShotPlanProgress(database, scene.id, shotPlan, session.id);

  for (const [shotIndex, shot] of shots.entries()) {
    const shotProgress = shotPlan[shotIndex];
    if (shotProgress.url) {
      logMediaGeneration('scene_video_shot_reused_existing', {
        ...mediaTaskLogContext(session, task, scene),
        mediaType: 'video',
        shotIndex: shotIndex + 1,
        shotCount: shots.length,
        duration: shotProgress.duration,
        localUrl: shotProgress.url,
      });
      continue;
    }

    let promptImageUrl = shotProgress.reference_image_url || scene.reference_image_url;
    let referencePrompt = shotProgress.reference_prompt || shot.referencePrompt;

    if (shots.length > 1 && shotIndex > 0 && !shotProgress.reference_image_url) {
      const continuityReference = await generateContinuityReferenceImage({
        session,
        task,
        scene,
        shot,
        shotIndex,
        shotCount: shots.length,
        openingReferenceImageUrl: scene.reference_image_url,
        openrouterApiKey,
        runwayClient,
        database,
      });
      promptImageUrl = continuityReference.localUrl;
      referencePrompt = continuityReference.promptText;
      shotProgress.reference_image_url = promptImageUrl;
      shotProgress.reference_prompt = referencePrompt;
      writeShotPlanProgress(database, scene.id, shotPlan, session.id);
    } else if (!shotProgress.reference_image_url) {
      shotProgress.reference_image_url = promptImageUrl;
      if (referencePrompt) shotProgress.reference_prompt = referencePrompt;
      writeShotPlanProgress(database, scene.id, shotPlan, session.id);
    }

    const moderatedPrompt = ensureRunwayVideoPromptMotion(await ensureSafePrompt(shot.prompt, { openrouterApiKey }));
    const repairedPrompt = await repairRunwayVideoPromptForValidation({
      promptText: moderatedPrompt,
      durationSeconds: shot.duration,
      openrouterApiKey,
    });
    const safePrompt = repairedPrompt.promptText;
    if (repairedPrompt.repaired) {
      logMediaGeneration('scene_video_prompt_repaired', {
        ...mediaTaskLogContext(session, task, scene),
        mediaType: 'video',
        shotIndex: shotIndex + 1,
        shotCount: shots.length,
        duration: shot.duration,
        promptText: safePrompt,
        error: repairedPrompt.validationError ? new Error(repairedPrompt.validationError) : undefined,
      }, 'warn');
    }
    assertRunwayVideoPrompt({
      promptText: safePrompt,
      durationSeconds: shot.duration,
    });
    logMediaGeneration('scene_video_shot_generation_start', {
      ...mediaTaskLogContext(session, task, scene),
      mediaType: 'video',
      shotIndex: shotIndex + 1,
      shotCount: shots.length,
      duration: shot.duration,
      promptImageUrl,
      promptText: safePrompt,
    });
    shotProgress.prompt = safePrompt;
    shotProgress.duration = shot.duration;
    shotProgress.status = 'running';
    delete shotProgress.last_error;
    writeShotPlanProgress(database, scene.id, shotPlan, session.id);

    try {
      const videoAsset = await generateVideoAsset({
        promptImageUrl,
        promptText: safePrompt,
        ratio: videoRatio(session.aspect_ratio),
        duration: shot.duration,
        sessionId: session.id,
        runwayClient,
        database,
        videoModel: getRunwayVideoModelForSession(database, session),
        logContext: {
          ...mediaTaskLogContext(session, task, scene),
          shotIndex: shotIndex + 1,
          shotCount: shots.length,
        },
      });
      shotProgress.url = videoAsset.localUrl;
      shotProgress.reference_image_url = promptImageUrl;
      if (referencePrompt) shotProgress.reference_prompt = referencePrompt;
      shotProgress.status = 'succeeded';
      delete shotProgress.last_error;
      writeShotPlanProgress(database, scene.id, shotPlan, session.id);
      logMediaGeneration('scene_video_shot_generated', {
        ...mediaTaskLogContext(session, task, scene),
        mediaType: 'video',
        shotIndex: shotIndex + 1,
        shotCount: shots.length,
        duration: shot.duration,
        localUrl: videoAsset.localUrl,
      });
    } catch (error) {
      shotProgress.status = 'failed';
      shotProgress.last_error = formatError(error);
      writeShotPlanProgress(database, scene.id, shotPlan, session.id);
      throw error;
    }
  }

  const videoUrls = shotPlanVideoUrls(shotPlan);
  if (!videoUrls.length) {
    throw new Error(`Scene ${scene.scene_index + 1} has no complete generated video shots.`);
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
  logMediaGeneration('scene_video_db_updated', {
    ...mediaTaskLogContext(session, task, scene),
    mediaType: 'video',
    shotCount: shotPlan.length,
    localUrl: outputAssetId,
  });
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

  const { renderFinalFilm } = await import('./final-render');
  const rendered = await renderFinalFilm({
    sessionId: session.id,
    aspectRatio: session.aspect_ratio,
    scenes,
    onProgress: (progress) => persistRenderProgress(database, session.id, progress),
  });

  completeRenderProgress(database, session.id);
  setSessionStatus(database, session.id, 'COMPLETED', rendered.publicUrl);
  notifyFinalRenderReady(database, session.id, rendered.publicUrl).catch((error) => {
    console.error('Failed to send final render email', error);
  });
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
  logMediaGeneration('media_task_running', {
    sessionId: task.session_id,
    taskId: task.id,
    kind: task.kind,
    sceneId: task.scene_id,
    provider: task.provider,
    attempt: task.attempts + 1,
    maxAttempts: task.max_attempts,
  });

  try {
    const outputAssetId = await executor({ database, task, session });
    completeMediaTask(database, task.id, typeof outputAssetId === 'string' ? outputAssetId : undefined);
    logMediaGeneration('media_task_succeeded', {
      sessionId: task.session_id,
      taskId: task.id,
      kind: task.kind,
      sceneId: task.scene_id,
      provider: task.provider,
    });
    return { ok: true as const };
  } catch (error) {
    const message = safeCredentialErrorMessage(error, formatError(error));
    failMediaTask(database, task.id, message);
    markSceneFailure(database, task, message);
    setSessionStatus(database, task.session_id, 'FAILED');
    broadcastProgress(database, task.session_id, message);
    logMediaGeneration('media_task_failed', {
      sessionId: task.session_id,
      taskId: task.id,
      kind: task.kind,
      sceneId: task.scene_id,
      provider: task.provider,
      error,
    }, 'error');
    return { ok: false as const, error };
  }
}

export async function runMediaTaskRunner(sessionId: string, options: MediaTaskRunnerOptions = {}): Promise<MediaTaskRunnerResult> {
  const database = options.database || db;
  const allowedKinds = runnableKinds(Boolean(options.includeRender), options.onlyKinds);
  const concurrencyMode = mediaTaskConcurrencyMode(database, sessionId, options.concurrencyMode);
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

export async function runFrameGenerationPhase(sessionId: string, options: Omit<MediaTaskRunnerOptions, 'includeRender' | 'onlyKinds' | 'completionMode'> = {}) {
  return runMediaTaskRunner(sessionId, {
    ...options,
    includeRender: false,
    onlyKinds: ['generate_scene_frame'],
    completionMode: 'frames',
  });
}

export async function runAutomaticProductionPipeline(
  sessionId: string,
  options: Omit<MediaTaskRunnerOptions, 'includeRender' | 'onlyKinds' | 'completionMode'> = {},
) {
  await runFrameGenerationPhase(sessionId, options);
  await runFinalAssetsPhase(sessionId, options);
  return runMediaTaskRunner(sessionId, {
    ...options,
    includeRender: true,
    onlyKinds: ['render_final'],
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
