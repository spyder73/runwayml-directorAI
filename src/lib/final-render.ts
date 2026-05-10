import { bundle } from '@remotion/bundler';
import { type Concurrency, type X264Preset, renderMedia, selectComposition } from '@remotion/renderer';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

type AspectRatio = '16:9' | '9:16';
type RenderQuality = 'fast' | 'standard' | 'ultra';

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
  sceneId: string;
  duration?: number;
  targetDuration?: number;
  tempo?: number;
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

const FPS = 30;
const MAX_NARRATION_TEMPO = 1.12;
const REMOTION_COMPOSITION_ID = 'LifeStoryFilm';
const H264_MIN_CRF = 1;
const H264_MAX_CRF = 51;
const PROGRESS_REPORT_BUCKETS = 50;

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

export function buildFinalRenderPlan(params: {
  sessionId: string;
  aspectRatio: AspectRatio;
  scenes: RenderScene[];
}): FinalRenderPlan {
  const orderedScenes = [...params.scenes].sort((a, b) => a.scene_index - b.scene_index);
  const filename = `${randomUUID()}.mp4`;
  const publicUrl = `/generated/final/${params.sessionId}/${filename}`;
  const outputFilePath = publicUrlToFilePath(publicUrl);
  const scenePlans = orderedScenes.map((scene) => {
    const urls = parseSceneVideoUrls(scene.video_url);
    const durations = videoDurationsForScene(scene, urls.length);
    const videoInputs = urls.map((url, index) => {
      const publicUrl = normalizePublicUrl(url);
      return {
        publicUrl,
        filePath: publicUrlToFilePath(publicUrl),
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
      const publicUrl = normalizePublicUrl(scenePlan.scene.audio_url || '');
      const audioDuration = scenePlan.scene.duration || scenePlan.videoDuration || 2;
      const targetDuration = scenePlan.videoDuration || audioDuration;
      return {
        publicUrl,
        filePath: publicUrlToFilePath(publicUrl),
        sceneId: scenePlan.scene.id,
        duration: audioDuration,
        targetDuration,
        tempo: narrationTempo(audioDuration, targetDuration),
      };
    });
  const { width, height } = dimensionsForAspectRatio(params.aspectRatio);
  const remotionScenes = scenePlans.map((scenePlan) => {
    const sceneDuration = scenePlan.videoDuration || scenePlan.scene.duration || 1;
    const fallbackClipDuration = sceneDuration / Math.max(scenePlan.videoInputs.length, 1);
    const audioInput = audioInputs.find((input) => input.sceneId === scenePlan.scene.id);

    return {
      id: scenePlan.scene.id,
      clips: scenePlan.videoInputs.map((input) => ({
        url: remotionAssetUrl(input.publicUrl),
        duration_in_frames: Math.max(1, Math.ceil((input.duration || fallbackClipDuration) * FPS)),
      })),
      audio_url: scenePlan.scene.audio_url ? remotionAssetUrl(scenePlan.scene.audio_url) : '',
      ...(audioInput?.tempo ? { audio_playback_rate: audioInput.tempo } : {}),
      narrator_text: scenePlan.scene.narrator_text,
      duration_in_frames: Math.max(1, Math.ceil(sceneDuration * FPS)),
    };
  });
  const totalDurationFrames = remotionScenes.reduce((total, scene) => total + scene.duration_in_frames, 0);

  return {
    publicUrl,
    outputFilePath,
    videoInputs,
    audioInputs,
    remotionInputProps: { scenes: remotionScenes },
    composition: {
      id: REMOTION_COMPOSITION_ID,
      width,
      height,
      fps: FPS,
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

function remotionRenderConcurrency(): Concurrency {
  const configured = process.env.REMOTION_CONCURRENCY?.trim() || '';
  if (!configured) return null;
  const numeric = Number(configured);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : configured;
}

function remotionRenderTimeout() {
  const configured = Number(process.env.REMOTION_TIMEOUT_MS || '');
  return Number.isFinite(configured) && configured > 0 ? configured : undefined;
}

function remotionX264Preset(): X264Preset {
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

export function createRemotionBundleResolver(bundleFn: RemotionBundleFn = bundle) {
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

export async function renderFinalFilm(params: {
  sessionId: string;
  aspectRatio: AspectRatio;
  scenes: RenderScene[];
  onProgress?: (progress: FinalRenderProgress) => void;
}) {
  const plan = {
    ...buildFinalRenderPlan(params),
    onProgress: params.onProgress,
  };
  await fs.mkdir(path.dirname(plan.outputFilePath), { recursive: true });
  await assertInputsExist([...plan.videoInputs, ...plan.audioInputs]);
  await runRemotionRender(plan);
  await fs.access(plan.outputFilePath);
  return {
    publicUrl: plan.publicUrl,
    filePath: plan.outputFilePath,
  };
}
