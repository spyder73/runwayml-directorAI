import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

type AspectRatio = '16:9' | '9:16';

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

export type FinalRenderPlan = {
  publicUrl: string;
  outputFilePath: string;
  videoInputs: RenderInput[];
  audioInputs: RenderInput[];
  filterGraph: string;
  ffmpegArgs: string[];
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

function dimensionsForAspectRatio(aspectRatio: AspectRatio) {
  return aspectRatio === '9:16'
    ? { width: 720, height: 1280 }
    : { width: 1280, height: 720 };
}

const MAX_NARRATION_TEMPO = 1.12;

function formatFilterNumber(value: number) {
  return value.toFixed(3).replace(/\.?0+$/, '');
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

function buildFilterGraph(params: {
  videoInputs: RenderInput[];
  audioInputs: RenderInput[];
  aspectRatio: AspectRatio;
}) {
  const { width, height } = dimensionsForAspectRatio(params.aspectRatio);
  const videoFilters = params.videoInputs.map((input, index) => {
    const durationFilter = input.duration
      ? `,tpad=stop_mode=clone:stop_duration=${formatFilterNumber(input.duration)},trim=0:${formatFilterNumber(input.duration)},setpts=PTS-STARTPTS`
      : '';
    return `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1${durationFilter},fps=30,format=yuv420p[v${index}]`;
  });
  const videoConcat = `${params.videoInputs.map((_, index) => `[v${index}]`).join('')}concat=n=${params.videoInputs.length}:v=1:a=0[vout]`;

  if (!params.audioInputs.length) {
    return [...videoFilters, videoConcat].join(';');
  }

  const audioOffset = params.videoInputs.length;
  const audioFilters = params.audioInputs.map((input, index) => {
    const targetDuration = Math.max(0.1, input.targetDuration || input.duration || 2);
    const tempoFilter = input.tempo && input.tempo > 1.001 ? `,atempo=${formatFilterNumber(input.tempo)}` : '';
    return `[${audioOffset + index}:a]aresample=48000${tempoFilter},apad,atrim=0:${formatFilterNumber(targetDuration)},asetpts=PTS-STARTPTS[a${index}]`;
  });
  const audioConcat = `${params.audioInputs.map((_, index) => `[a${index}]`).join('')}concat=n=${params.audioInputs.length}:v=0:a=1[aout]`;

  return [...videoFilters, videoConcat, ...audioFilters, audioConcat].join(';');
}

function buildFfmpegArgs(params: {
  outputFilePath: string;
  videoInputs: RenderInput[];
  audioInputs: RenderInput[];
  filterGraph: string;
}) {
  const inputArgs = [...params.videoInputs, ...params.audioInputs].flatMap((input) => ['-i', input.filePath]);
  const audioArgs = params.audioInputs.length
    ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-shortest']
    : ['-an'];

  return [
    '-y',
    ...inputArgs,
    '-filter_complex',
    params.filterGraph,
    '-map',
    '[vout]',
    ...audioArgs,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    params.outputFilePath,
  ];
}

export function buildFinalRenderPlan(params: {
  sessionId: string;
  aspectRatio: AspectRatio;
  scenes: RenderScene[];
}): FinalRenderPlan {
  const orderedScenes = [...params.scenes].sort((a, b) => a.scene_index - b.scene_index);
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

  const filename = `${randomUUID()}.mp4`;
  const publicUrl = `/generated/final/${params.sessionId}/${filename}`;
  const outputFilePath = publicUrlToFilePath(publicUrl);
  const filterGraph = buildFilterGraph({ videoInputs, audioInputs, aspectRatio: params.aspectRatio });

  return {
    publicUrl,
    outputFilePath,
    videoInputs,
    audioInputs,
    filterGraph,
    ffmpegArgs: buildFfmpegArgs({ outputFilePath, videoInputs, audioInputs, filterGraph }),
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

function runFfmpeg(args: string[]) {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Final render failed with ffmpeg exit ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

export async function renderFinalFilm(params: {
  sessionId: string;
  aspectRatio: AspectRatio;
  scenes: RenderScene[];
}) {
  const plan = buildFinalRenderPlan(params);
  await fs.mkdir(path.dirname(plan.outputFilePath), { recursive: true });
  await assertInputsExist([...plan.videoInputs, ...plan.audioInputs]);
  await runFfmpeg(plan.ffmpegArgs);
  await fs.access(plan.outputFilePath);
  return {
    publicUrl: plan.publicUrl,
    filePath: plan.outputFilePath,
  };
}
