import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import db from './db';
import { resolveFinalRenderBackend } from './final-render-backend';
import {
  createMediaAssetForSession,
  createPrivateMediaFilePath,
  mediaAssetUrl,
  resolveMediaUrlToFilePath,
} from './media-assets';
import {
  buildModalRenderRequest,
  modalRenderConfig,
  runModalRenderBridge,
} from './modal-render';
import {
  REMOTION_FPS,
  totalFilmDurationInFrames,
} from '../remotion/timing';
import { getFinalRenderBackendForSession } from './providers/user-credentials';

type AspectRatio = '16:9' | '9:16';
type RenderQuality = 'fast' | 'standard' | 'ultra';
type SqliteDatabase = Database.Database;

type RenderScene = {
  id: string;
  scene_index: number;
  narrator_text: string;
  video_url: string | null;
  shot_plan_json?: string | null;
  audio_url: string | null;
  duration: number | null;
};

type RenderInput = {
  publicUrl: string;
  filePath: string;
  remotionUrl: string;
  sceneId: string;
  duration?: number;
  targetDuration?: number;
  tempo?: number;
  effectiveDuration?: number;
};

type RemotionRenderClip = {
  url: string;
  duration_in_frames: number;
};

type RemotionRenderScene = {
  id: string;
  clips: RemotionRenderClip[];
  audio_url: string;
  audio_playback_rate?: number;
  narrator_text: string;
  duration_in_frames: number;
  narration_duration_in_frames?: number;
};

export type FinalRenderProgress = {
  progress: number;
  message: string;
  renderedFrames: number | null;
  encodedFrames: number | null;
  totalFrames: number | null;
  stitchStage: string | null;
};

export type FinalRenderPlan = {
  publicUrl: string;
  outputFilePath: string;
  outputMediaAssetId?: string;
  outputFilePathRelative?: string;
  videoInputs: RenderInput[];
  audioInputs: RenderInput[];
  remotionInputProps: { scenes: RemotionRenderScene[] };
  composition: {
    id: string;
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
  };
  entryPoint: string;
  onProgress?: (progress: FinalRenderProgress) => void;
};

type RemotionBundleOptions = {
  entryPoint: string;
  publicDir: string;
  enableCaching: boolean;
};

type RemotionBundleFn = (options: RemotionBundleOptions) => Promise<string>;
type RemotionRenderEnv = {
  [key: string]: string | undefined;
  REMOTION_CRF?: string;
  REMOTION_RENDER_QUALITY?: string;
};
type RemotionConcurrency = number | string | null;
type RemotionX264Preset =
  | 'ultrafast'
  | 'superfast'
  | 'veryfast'
  | 'faster'
  | 'fast'
  | 'medium'
  | 'slow'
  | 'slower'
  | 'veryslow'
  | 'placebo';

const externalImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

async function loadRemotionBundler() {
  return externalImport<typeof import('@remotion/bundler')>('@remotion/bundler');
}

async function loadRemotionRenderer() {
  return externalImport<typeof import('@remotion/renderer')>('@remotion/renderer');
}

async function defaultRemotionBundle(options: RemotionBundleOptions) {
  const { bundle } = await loadRemotionBundler();
  return bundle(options);
}

function normalizePublicUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed.startsWith('/')) {
    throw new Error(`Generated media must be a local public URL: ${url}`);
  }
  return trimmed;
}

function publicUrlToFilePath(publicUrl: string) {
  return path.join(process.cwd(), 'public', publicUrl.replace(/^\/+/, ''));
}

function remotionAssetUrl(publicUrl: string) {
  if (!publicUrl.startsWith('/')) return publicUrl;
  return `/public${publicUrl}`;
}

function resolveRenderInputUrl(url: string, database: SqliteDatabase | undefined, sessionId: string) {
  const publicUrl = normalizePublicUrl(url);
  const mediaFile = database ? resolveMediaUrlToFilePath(database, publicUrl, sessionId) : null;
  if (mediaFile) {
    return {
      publicUrl,
      filePath: mediaFile.filePath,
      remotionUrl: pathToFileURL(mediaFile.filePath).href,
    };
  }

  return {
    publicUrl,
    filePath: publicUrlToFilePath(publicUrl),
    remotionUrl: remotionAssetUrl(publicUrl),
  };
}

export function parseSceneVideoUrls(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
    }
  } catch {}
  return [value].filter((url) => url.trim().length > 0);
}

const MAX_NARRATION_TEMPO = 1.12;
const REMOTION_COMPOSITION_ID = 'LifeStoryFilm';
const H264_MIN_CRF = 1;
const H264_MAX_CRF = 51;
const PROGRESS_REPORT_BUCKETS = 50;

export { resolveFinalRenderBackend };

function remotionRenderQuality(env: RemotionRenderEnv = process.env): RenderQuality {
  const configured = env.REMOTION_RENDER_QUALITY?.trim().toLowerCase();
  return configured === 'fast' || configured === 'ultra' ? configured : 'standard';
}

function dimensionsForAspectRatio(aspectRatio: AspectRatio) {
  const quality = remotionRenderQuality();
  if (quality === 'fast') {
    return aspectRatio === '9:16'
      ? { width: 540, height: 960 }
      : { width: 960, height: 540 };
  }
  if (quality === 'ultra') {
    return aspectRatio === '9:16'
      ? { width: 1080, height: 1920 }
      : { width: 1920, height: 1080 };
  }
  return aspectRatio === '9:16'
    ? { width: 720, height: 1280 }
    : { width: 1280, height: 720 };
}

function distributeDuration(totalDuration: number, count: number) {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0 || count <= 0) return [];
  const totalMillis = Math.max(1, Math.round(totalDuration * 1000));
  const baseMillis = Math.floor(totalMillis / count);
  let remainder = totalMillis - baseMillis * count;

  return Array.from({ length: count }, () => {
    const durationMillis = baseMillis + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return durationMillis / 1000;
  });
}

function parseShotPlanDurations(value: string | null | undefined, urlCount: number) {
  if (!value || urlCount <= 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const durations = parsed
      .map((item) => (typeof item === 'object' && item !== null ? Number((item as { duration?: unknown }).duration) : Number.NaN))
      .filter((duration) => Number.isFinite(duration) && duration > 0)
      .slice(0, urlCount);
    return durations.length === urlCount ? durations : [];
  } catch {
    return [];
  }
}

function videoDurationsForScene(scene: RenderScene, urlCount: number) {
  const plannedDurations = parseShotPlanDurations(scene.shot_plan_json, urlCount);
  if (plannedDurations.length) return plannedDurations;
  return distributeDuration(scene.duration || 0, urlCount);
}

function narrationTempo(audioDuration: number, targetDuration: number) {
  if (!Number.isFinite(audioDuration) || !Number.isFinite(targetDuration) || targetDuration <= 0) return undefined;
  if (audioDuration <= targetDuration + 0.05) return undefined;
  return Math.min(MAX_NARRATION_TEMPO, audioDuration / targetDuration);
}

function effectiveNarrationDuration(audioDuration: number, tempo: number | undefined) {
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) return 1;
  if (!tempo || !Number.isFinite(tempo) || tempo <= 0) return audioDuration;
  return audioDuration / tempo;
}

export function buildFinalRenderPlan(params: {
  sessionId: string;
  aspectRatio: AspectRatio;
  scenes: RenderScene[];
  database?: SqliteDatabase;
}): FinalRenderPlan {
  const orderedScenes = [...params.scenes].sort((a, b) => a.scene_index - b.scene_index);
  const outputMediaAssetId = randomUUID();
  const privateOutput = params.database
    ? createPrivateMediaFilePath({
      scope: 'generated',
      kind: 'final',
      sessionId: params.sessionId,
      id: outputMediaAssetId,
      extension: 'mp4',
    })
    : null;
  const filename = `${outputMediaAssetId}.mp4`;
  const publicUrl = privateOutput ? mediaAssetUrl(outputMediaAssetId) : `/generated/final/${params.sessionId}/${filename}`;
  const outputFilePath = privateOutput?.absolutePath || publicUrlToFilePath(publicUrl);
  const scenePlans = orderedScenes.map((scene) => {
    const urls = parseSceneVideoUrls(scene.video_url);
    const durations = videoDurationsForScene(scene, urls.length);
    const videoInputs = urls.map((url, index) => {
      const resolved = resolveRenderInputUrl(url, params.database, params.sessionId);
      return {
        ...resolved,
        sceneId: scene.id,
        duration: durations[index],
      };
    });
    const videoDuration = durations.reduce((total, duration) => total + duration, 0) || scene.duration || undefined;

    return { scene, videoInputs, videoDuration };
  });
  const videoInputs = scenePlans.flatMap((scenePlan) => scenePlan.videoInputs);

  if (!videoInputs.length) {
    throw new Error('No generated video clips are available for final render.');
  }

  const audioInputs = scenePlans
    .filter((scenePlan) => scenePlan.scene.audio_url)
    .map((scenePlan) => {
      const resolved = resolveRenderInputUrl(scenePlan.scene.audio_url || '', params.database, params.sessionId);
      const audioDuration = scenePlan.scene.duration || scenePlan.videoDuration || 2;
      const targetDuration = scenePlan.videoDuration || audioDuration;
      const tempo = narrationTempo(audioDuration, targetDuration);
      return {
        ...resolved,
        sceneId: scenePlan.scene.id,
        duration: audioDuration,
        targetDuration,
        tempo,
        effectiveDuration: effectiveNarrationDuration(audioDuration, tempo),
      };
    });
  const { width, height } = dimensionsForAspectRatio(params.aspectRatio);
  const remotionScenes = scenePlans.map((scenePlan) => {
    const audioInput = audioInputs.find((input) => input.sceneId === scenePlan.scene.id);
    const narrationDuration = audioInput?.effectiveDuration || scenePlan.scene.duration || scenePlan.videoDuration || 1;
    const sceneDuration = Math.max(scenePlan.videoDuration || 0, narrationDuration, 1);
    const fallbackClipDuration = sceneDuration / Math.max(scenePlan.videoInputs.length, 1);

    return {
      id: scenePlan.scene.id,
      clips: scenePlan.videoInputs.map((input) => ({
        url: input.remotionUrl,
        duration_in_frames: Math.max(1, Math.ceil((input.duration || fallbackClipDuration) * REMOTION_FPS)),
      })),
      audio_url: audioInput?.remotionUrl || '',
      ...(audioInput?.tempo ? { audio_playback_rate: audioInput.tempo } : {}),
      narrator_text: scenePlan.scene.narrator_text,
      duration_in_frames: Math.max(1, Math.ceil(sceneDuration * REMOTION_FPS)),
      narration_duration_in_frames: Math.max(1, Math.ceil(Math.min(narrationDuration, sceneDuration) * REMOTION_FPS)),
    };
  });
  const totalDurationFrames = totalFilmDurationInFrames(remotionScenes);

  return {
    publicUrl,
    outputFilePath,
    ...(privateOutput ? { outputMediaAssetId, outputFilePathRelative: privateOutput.relativePath } : {}),
    videoInputs,
    audioInputs,
    remotionInputProps: { scenes: remotionScenes },
    composition: {
      id: REMOTION_COMPOSITION_ID,
      width,
      height,
      fps: REMOTION_FPS,
      durationInFrames: totalDurationFrames,
    },
    entryPoint: remotionEntryPoint(),
  };
}

async function assertInputsExist(inputs: RenderInput[]) {
  await Promise.all(inputs.map(async (input) => {
    try {
      await fs.access(input.filePath);
    } catch {
      throw new Error(`Generated media file is missing: ${input.publicUrl}`);
    }
  }));
}

function remotionBrowserExecutable() {
  return process.env.REMOTION_BROWSER_EXECUTABLE || process.env.CHROME_BIN || null;
}

function remotionEntryPoint() {
  return process.env.REMOTION_ENTRY_POINT || path.join(process.cwd(), 'src', 'remotion', 'Root.tsx');
}

function shouldEnableRemotionBundleCache() {
  return process.env.REMOTION_BUNDLE_CACHE === 'true';
}

function remotionRenderConcurrency(): RemotionConcurrency {
  const configured = process.env.REMOTION_CONCURRENCY?.trim() || '';
  if (!configured) return null;
  const numeric = Number(configured);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : configured;
}

function remotionRenderTimeout() {
  const configured = Number(process.env.REMOTION_TIMEOUT_MS || '');
  return Number.isFinite(configured) && configured > 0 ? configured : undefined;
}

function remotionX264Preset(): RemotionX264Preset {
  const configured = process.env.REMOTION_X264_PRESET;
  if (
    configured === 'ultrafast' ||
    configured === 'superfast' ||
    configured === 'veryfast' ||
    configured === 'faster' ||
    configured === 'fast' ||
    configured === 'medium' ||
    configured === 'slow' ||
    configured === 'slower' ||
    configured === 'veryslow' ||
    configured === 'placebo'
  ) {
    return configured;
  }

  return remotionRenderQuality() === 'fast' ? 'superfast' : 'veryfast';
}

export function resolveRemotionCrf(env: RemotionRenderEnv = process.env) {
  const configured = env.REMOTION_CRF?.trim();
  if (configured) {
    const numeric = Number(configured);
    if (Number.isFinite(numeric)) {
      if (numeric === 0) return H264_MIN_CRF;
      if (numeric > 0 && numeric < H264_MIN_CRF) return H264_MIN_CRF;
      if (numeric >= H264_MIN_CRF && numeric <= H264_MAX_CRF) return numeric;
    }
  }

  const quality = remotionRenderQuality(env);
  if (quality === 'fast') return 28;
  if (quality === 'ultra') return 18;
  return 20;
}

export function createRemotionBundleResolver(bundleFn: RemotionBundleFn = defaultRemotionBundle) {
  let bundlePromise: Promise<string> | null = null;
  let bundledEntryPoint: string | null = null;

  return function resolveRemotionBundle(plan: Pick<FinalRenderPlan, 'entryPoint'>) {
    if (!bundlePromise || bundledEntryPoint !== plan.entryPoint) {
      bundledEntryPoint = plan.entryPoint;
      bundlePromise = bundleFn({
        entryPoint: plan.entryPoint,
        publicDir: path.join(process.cwd(), 'public'),
        enableCaching: shouldEnableRemotionBundleCache(),
      }).catch((error) => {
        bundlePromise = null;
        bundledEntryPoint = null;
        throw error;
      });
    }

    return bundlePromise;
  };
}

const resolveRemotionBundle = createRemotionBundleResolver();

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, Number(value.toFixed(3))));
}

function stitchStageLabel(stitchStage: unknown) {
  if (typeof stitchStage !== 'string') return null;
  return stitchStage.trim() || null;
}

function renderProgressMessage(stitchStage: string | null) {
  return stitchStage ? 'Encoding final video' : 'Rendering frames';
}

function reportFinalRenderProgress(plan: FinalRenderPlan, progress: FinalRenderProgress) {
  try {
    plan.onProgress?.(progress);
  } catch (error) {
    console.error('Failed to report final render progress', error);
  }
}

async function runRemotionRender(plan: FinalRenderPlan) {
  const { renderMedia, selectComposition } = await loadRemotionRenderer();
  const serveUrl = await resolveRemotionBundle(plan);
  const browserExecutable = remotionBrowserExecutable() || undefined;
  const concurrency = remotionRenderConcurrency();
  const timeoutInMilliseconds = remotionRenderTimeout();
  const x264Preset = remotionX264Preset();
  const crf = resolveRemotionCrf();
  const selectedComposition = await selectComposition({
    serveUrl,
    id: plan.composition.id,
    inputProps: plan.remotionInputProps,
    ...(browserExecutable ? { browserExecutable } : {}),
    timeoutInMilliseconds,
    logLevel: 'warn',
  });

  let lastLoggedProgress = -1;
  let lastReportedProgress = -1;
  let totalFrames = plan.composition.durationInFrames;
  await renderMedia({
    serveUrl,
    composition: {
      ...selectedComposition,
      width: plan.composition.width,
      height: plan.composition.height,
      fps: plan.composition.fps,
      durationInFrames: plan.composition.durationInFrames,
    },
    inputProps: plan.remotionInputProps,
    codec: 'h264',
    outputLocation: plan.outputFilePath,
    overwrite: true,
    crf,
    pixelFormat: 'yuv420p',
    ...(browserExecutable ? { browserExecutable } : {}),
    concurrency,
    timeoutInMilliseconds,
    x264Preset,
    onStart: ({ frameCount }) => {
      totalFrames = frameCount || plan.composition.durationInFrames;
      reportFinalRenderProgress(plan, {
        progress: 0,
        message: 'Starting final render',
        renderedFrames: 0,
        encodedFrames: 0,
        totalFrames,
        stitchStage: null,
      });
      console.log(JSON.stringify({
        scope: 'final-render',
        message: 'render-started',
        frames: frameCount,
        concurrency,
        x264Preset,
        crf,
        quality: remotionRenderQuality(),
      }));
    },
    onProgress: ({ renderedFrames, encodedFrames, progress, stitchStage }) => {
      const progressBucket = Math.floor(progress * 10);
      const reportBucket = Math.floor(progress * PROGRESS_REPORT_BUCKETS);
      const stage = stitchStageLabel(stitchStage);
      if (reportBucket !== lastReportedProgress || progress >= 1) {
        lastReportedProgress = reportBucket;
        reportFinalRenderProgress(plan, {
          progress: clampProgress(progress),
          message: renderProgressMessage(stage),
          renderedFrames,
          encodedFrames: encodedFrames ?? 0,
          totalFrames,
          stitchStage: stage,
        });
      }
      if (progressBucket !== lastLoggedProgress || progress >= 1) {
        lastLoggedProgress = progressBucket;
        console.log(JSON.stringify({
          scope: 'final-render',
          message: 'render-progress',
          renderedFrames,
          encodedFrames: encodedFrames ?? 0,
          progress: Number(progress.toFixed(3)),
          stitchStage,
        }));
      }
    },
    logLevel: 'warn',
  });
}

async function runModalRemotionRender(plan: FinalRenderPlan) {
  const config = modalRenderConfig();
  const request = buildModalRenderRequest(plan, {
    appName: config.appName,
    functionName: config.functionName,
    volumeName: config.volumeName,
    volumeMountPath: config.volumeMountPath,
    jobId: `${plan.composition.id}-${Date.now()}`,
    renderOptions: {
      crf: resolveRemotionCrf(),
      x264Preset: remotionX264Preset(),
      timeoutInMilliseconds: remotionRenderTimeout(),
      concurrency: remotionRenderConcurrency(),
    },
  });

  reportFinalRenderProgress(plan, {
    progress: 0.03,
    message: 'Uploading media to Modal',
    renderedFrames: 0,
    encodedFrames: 0,
    totalFrames: plan.composition.durationInFrames,
    stitchStage: null,
  });

  console.log(JSON.stringify({
    scope: 'final-render',
    backend: 'modal',
    message: 'modal-render-submit',
    appName: request.appName,
    functionName: request.functionName,
    volumeName: request.volumeName,
    inputCount: request.inputFiles.length,
    outputLocalPath: request.outputLocalPath,
    outputVolumePath: request.manifest.outputVolumePath,
    width: request.manifest.composition.width,
    height: request.manifest.composition.height,
    durationInFrames: request.manifest.composition.durationInFrames,
  }));

  try {
    const result = await runModalRenderBridge(request, config.bridgeUrl);
    console.log(JSON.stringify({
      scope: 'final-render',
      backend: 'modal',
      message: 'modal-render-completed',
      outputLocalPath: result.outputLocalPath,
      byteSize: result.byteSize,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      scope: 'final-render',
      backend: 'modal',
      message: 'modal-render-failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }

  reportFinalRenderProgress(plan, {
    progress: 1,
    message: 'Final video ready',
    renderedFrames: plan.composition.durationInFrames,
    encodedFrames: plan.composition.durationInFrames,
    totalFrames: plan.composition.durationInFrames,
    stitchStage: 'modal',
  });
}

export async function renderFinalFilm(params: {
  sessionId: string;
  aspectRatio: AspectRatio;
  scenes: RenderScene[];
  database?: SqliteDatabase;
  onProgress?: (progress: FinalRenderProgress) => void;
}) {
  const database = params.database || db;
  const plan = {
    ...buildFinalRenderPlan({ ...params, database }),
    onProgress: params.onProgress,
  };
  const preferredBackend = getFinalRenderBackendForSession(database, params.sessionId);
  const backend = resolveFinalRenderBackend(process.env, preferredBackend);
  console.log(JSON.stringify({
    scope: 'final-render',
    message: 'backend-selected',
    sessionId: params.sessionId,
    preferredBackend,
    selectedBackend: backend,
    envBackend: process.env.FINAL_RENDER_BACKEND || null,
  }));
  await fs.mkdir(path.dirname(plan.outputFilePath), { recursive: true });
  await assertInputsExist([...plan.videoInputs, ...plan.audioInputs]);
  if (backend === 'modal') {
    await runModalRemotionRender(plan);
  } else {
    await runRemotionRender(plan);
  }
  const outputStats = await fs.stat(plan.outputFilePath);
  if (plan.outputMediaAssetId && plan.outputFilePathRelative) {
    createMediaAssetForSession(database, {
      id: plan.outputMediaAssetId,
      sessionId: params.sessionId,
      kind: 'final',
      filePath: plan.outputFilePathRelative,
      mimeType: 'video/mp4',
      byteSize: outputStats.size,
      originalName: null,
    });
  }
  return {
    publicUrl: plan.publicUrl,
    filePath: plan.outputFilePath,
    ...(plan.outputMediaAssetId ? { mediaAssetId: plan.outputMediaAssetId } : {}),
  };
}
