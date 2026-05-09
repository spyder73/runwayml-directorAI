import RunwayML, { toFile } from '@runwayml/sdk';
import type { TaskRetrieveResponse } from '@runwayml/sdk/resources/tasks';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

type AspectRatio = '16:9' | '9:16';
type MediaType = 'image' | 'audio' | 'video';
type RunwayTaskOutput = { output: string[] };
type GptImageQuality = 'low' | 'medium' | 'high' | 'auto';

export type GeneratedAsset = {
  remoteUrl: string;
  localUrl: string;
  filePath: string;
  mediaType: MediaType;
};

export type RunwayReferenceImage = {
  uri: string;
  tag?: string;
};

type GptImage2CreateParams = {
  model: 'gpt_image_2';
  promptText: string;
  quality: GptImageQuality;
  ratio: '1920:1088' | '1088:1920';
  referenceImages?: RunwayReferenceImage[];
};

const runway = new RunwayML({
  apiKey: process.env.RUNWAYML_API_SECRET || '',
});

const runwayUploadCache = new Map<string, Promise<string>>();

const createGptImage2 = runway.textToImage.create.bind(runway.textToImage) as unknown as (
  body: GptImage2CreateParams,
  options?: { timeout?: number },
) => Promise<{ id: string; waitForTaskOutput?: (options?: { timeout?: number | null }) => Promise<TaskRetrieveResponse.Succeeded> }>;

function requireRunwayApiKey() {
  if (!process.env.RUNWAYML_API_SECRET) {
    throw new Error('Missing RUNWAYML_API_SECRET. Real Runway generation requires API credentials.');
  }
}

export function imageRatio(aspectRatio: AspectRatio): GptImage2CreateParams['ratio'] {
  return aspectRatio === '9:16' ? '1088:1920' : '1920:1088';
}

export function videoRatio(aspectRatio: AspectRatio) {
  return aspectRatio === '9:16' ? '720:1280' : '1280:720';
}

export async function loadReferenceImage(filePath: string, tag?: string): Promise<RunwayReferenceImage> {
  const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  const absolutePath = path.join(process.cwd(), 'public', normalizedPath);
  const buffer = await fs.readFile(absolutePath);
  const ext = path.extname(normalizedPath).replace('.', '').toLowerCase();
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return {
    uri: `data:${mimeType};base64,${buffer.toString('base64')}`,
    ...(tag ? { tag } : {}),
  };
}

function mimeTypeForLocalPath(filePath: string) {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  return 'image/jpeg';
}

async function uploadLocalAssetForRunway(localOrRemoteUrl: string) {
  if (/^(https?:|runway:)/i.test(localOrRemoteUrl)) {
    return localOrRemoteUrl;
  }

  const normalizedPath = localOrRemoteUrl.startsWith('/') ? localOrRemoteUrl.slice(1) : localOrRemoteUrl;
  const absolutePath = path.join(process.cwd(), 'public', normalizedPath);
  const cached = runwayUploadCache.get(absolutePath);
  if (cached) return cached;

  const uploadPromise = (async () => {
    const buffer = await fs.readFile(absolutePath);
    const fileName = path.basename(normalizedPath);
    const file = await toFile(buffer, fileName, { type: mimeTypeForLocalPath(normalizedPath) });
    const upload = await runway.uploads.createEphemeral({ file }, { timeout: 60000 });
    return upload.uri;
  })();

  runwayUploadCache.set(absolutePath, uploadPromise);

  try {
    return await uploadPromise;
  } catch (error) {
    runwayUploadCache.delete(absolutePath);
    throw error;
  }
}

async function retryTaskCreation<T>(label: string, createTask: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await createTask();
    } catch (error) {
      lastError = error;
      if (isValidationError(error)) {
        break;
      }
      if (attempt === maxAttempts) break;
      console.warn(`${label} task creation failed, retrying (${attempt}/${maxAttempts})`, error);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} task creation failed`);
}

function isValidationError(error: unknown) {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown }).status;
  return status === 400;
}

async function waitForOutput(
  taskPromise: Promise<{ id: string; waitForTaskOutput?: (options?: { timeout?: number | null }) => Promise<TaskRetrieveResponse.Succeeded> }>,
  label: string,
): Promise<RunwayTaskOutput> {
  const task = await taskPromise;
  if (task.waitForTaskOutput) {
    const output = await task.waitForTaskOutput({ timeout: 600000 });
    return { output: output.output };
  }

  const startTime = Date.now();
  while (Date.now() - startTime < 600000) {
    const current = await runway.tasks.retrieve(task.id);
    if (current.status === 'SUCCEEDED') return { output: current.output };
    if (current.status === 'FAILED') throw new Error(`${label} failed: ${current.failure}`);
    if (current.status === 'CANCELLED') throw new Error(`${label} was cancelled`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`${label} timed out waiting for Runway task output`);
}

function firstOutputUrl(task: RunwayTaskOutput, label: string) {
  const url = task.output[0];
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error(`${label} completed without a usable output URL`);
  }
  return url;
}

function extensionFor(contentType: string | null, remoteUrl: string, mediaType: MediaType) {
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'jpg';
  if (contentType?.includes('mpeg')) return 'mp3';
  if (contentType?.includes('wav')) return 'wav';
  if (contentType?.includes('mp4')) return 'mp4';

  const ext = path.extname(new URL(remoteUrl).pathname).replace('.', '').toLowerCase();
  if (ext) return ext;
  if (mediaType === 'image') return 'jpg';
  if (mediaType === 'audio') return 'mp3';
  return 'mp4';
}

export async function persistGeneratedAsset(remoteUrl: string, mediaType: MediaType, sessionId: string): Promise<GeneratedAsset> {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to download generated ${mediaType}: ${response.status} ${response.statusText}`);
  }

  const ext = extensionFor(response.headers.get('content-type'), remoteUrl, mediaType);
  const directory = path.join('generated', mediaType, sessionId);
  const filename = `${uuidv4()}.${ext}`;
  const filePath = path.join(directory, filename);
  const absolutePath = path.join(process.cwd(), 'public', filePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, Buffer.from(await response.arrayBuffer()));

  return {
    remoteUrl,
    localUrl: `/${filePath}`,
    filePath,
    mediaType,
  };
}

export async function generateImageAsset(params: {
  promptText: string;
  quality: GptImageQuality;
  ratio: GptImage2CreateParams['ratio'];
  referenceImages?: RunwayReferenceImage[];
  sessionId: string;
}) {
  requireRunwayApiKey();
  const task = await waitForOutput(
    retryTaskCreation('Runway image', () => createGptImage2({
      model: 'gpt_image_2',
      promptText: params.promptText,
      quality: params.quality,
      ratio: params.ratio,
      referenceImages: params.referenceImages?.length ? params.referenceImages : undefined,
    }, { timeout: 60000 })),
    'Runway image generation',
  );

  return persistGeneratedAsset(firstOutputUrl(task, 'Runway image generation'), 'image', params.sessionId);
}

export async function generateSpeechAsset(params: {
  promptText: string;
  sessionId: string;
}) {
  requireRunwayApiKey();
  const task = await waitForOutput(
    retryTaskCreation('Runway TTS', () => runway.textToSpeech.create({
      model: 'eleven_multilingual_v2',
      promptText: params.promptText,
      voice: { type: 'runway-preset', presetId: 'Bernard' },
    }, { timeout: 60000 })),
    'Runway TTS generation',
  );

  return persistGeneratedAsset(firstOutputUrl(task, 'Runway TTS generation'), 'audio', params.sessionId);
}

export async function generateVideoAsset(params: {
  promptImageUrl: string;
  promptText: string;
  ratio: ReturnType<typeof videoRatio>;
  duration: number;
  sessionId: string;
}) {
  requireRunwayApiKey();
  const promptImageUri = await uploadLocalAssetForRunway(params.promptImageUrl);
  const task = await waitForOutput(
    retryTaskCreation('Runway video', () => runway.imageToVideo.create({
      model: 'gen4_turbo',
      promptImage: [{ uri: promptImageUri, position: 'first' }],
      ratio: params.ratio,
      promptText: params.promptText,
      duration: Math.max(2, Math.min(10, Math.ceil(params.duration))),
    }, { timeout: 60000 })),
    'Runway video generation',
  );

  return persistGeneratedAsset(firstOutputUrl(task, 'Runway video generation'), 'video', params.sessionId);
}
