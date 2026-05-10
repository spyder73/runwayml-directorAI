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
  audio_url: string | null;
  duration: number | null;
};

type RenderInput = {
  publicUrl: string;
  filePath: string;
  sceneId: string;
  duration?: number;
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

function buildFilterGraph(params: {
  videoInputs: RenderInput[];
  audioInputs: RenderInput[];
  aspectRatio: AspectRatio;
}) {
  const { width, height } = dimensionsForAspectRatio(params.aspectRatio);
  const videoFilters = params.videoInputs.map((_, index) => (
    `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30,format=yuv420p[v${index}]`
  ));
  const videoConcat = `${params.videoInputs.map((_, index) => `[v${index}]`).join('')}concat=n=${params.videoInputs.length}:v=1:a=0[vout]`;

  if (!params.audioInputs.length) {
    return [...videoFilters, videoConcat].join(';');
  }

  const audioOffset = params.videoInputs.length;
  const audioFilters = params.audioInputs.map((input, index) => {
    const duration = Math.max(2, Math.ceil(input.duration || 2));
    return `[${audioOffset + index}:a]aresample=48000,apad,atrim=0:${duration},asetpts=PTS-STARTPTS[a${index}]`;
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
  const videoInputs = orderedScenes.flatMap((scene) => parseSceneVideoUrls(scene.video_url).map((url) => {
    const publicUrl = normalizePublicUrl(url);
    return {
      publicUrl,
      filePath: publicUrlToFilePath(publicUrl),
      sceneId: scene.id,
    };
  }));

  if (!videoInputs.length) {
    throw new Error('No generated video clips are available for final render.');
  }

  const audioInputs = orderedScenes
    .filter((scene) => scene.audio_url)
    .map((scene) => {
      const publicUrl = normalizePublicUrl(scene.audio_url || '');
      return {
        publicUrl,
        filePath: publicUrlToFilePath(publicUrl),
        sceneId: scene.id,
        duration: scene.duration || 2,
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
