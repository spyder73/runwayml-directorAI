import RunwayML, { toFile } from '@runwayml/sdk';
import type { TaskRetrieveResponse } from '@runwayml/sdk/resources/tasks';
import type Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from './db';
import {
  IMAGE_MODEL,
  NARRATION_MODEL,
  RUNWAY_TASK_CREATE_TIMEOUT_MS,
  RUNWAY_TASK_POLL_INTERVAL_MS,
  RUNWAY_TASK_WAIT_TIMEOUT_MS,
  getRunwayVideoModel,
} from './production-config';
import type { RunwayVideoModel } from './types';
import { logMediaGeneration, type MediaGenerationLogDetails } from './media-logging';
import {
  createMediaAssetForSession,
  createPrivateMediaFilePath,
  mediaAssetUrl,
  resolveMediaUrlToFilePath,
} from './media-assets';

type AspectRatio = '16:9' | '9:16';
type MediaType = 'image' | 'audio' | 'video';
type SqliteDatabase = Database.Database;
type RunwayTaskOutput = { output: string[] };
type GptImageQuality = 'low' | 'medium' | 'high' | 'auto';
type RunwayVideoRatio = '720:1280' | '1280:720' | '1080:1920' | '1920:1080';
type RunwayImageToVideoModel = 'gen4_turbo' | 'gen4.5' | 'seedance2' | 'veo3.1_fast' | string;
export type RunwayClient = InstanceType<typeof RunwayML>;

export type GeneratedAsset = {
  remoteUrl: string;
  localUrl: string;
  filePath: string;
  mediaType: MediaType;
  mediaAssetId: string;
};

export type RunwayReferenceImage = {
  uri: string;
  tag?: string;
};

type GptImage2CreateParams = {
  model: typeof IMAGE_MODEL;
  promptText: string;
  quality: GptImageQuality;
  ratio: '1920:1088' | '1088:1920';
  referenceImages?: RunwayReferenceImage[];
};

type ImageToVideoCreateParams = {
  model: RunwayImageToVideoModel;
  promptImage: Array<{ uri: string; position: 'first' }>;
  ratio: RunwayVideoRatio;
  promptText: string;
  duration: number;
};

export const RUNWAY_REFERENCE_DATA_URI_MAX_LENGTH = 5_242_880;

const runwayUploadCache = new WeakMap<object, Map<string, Promise<string>>>();

type TextToImageResource = {
  create: (
    body: GptImage2CreateParams,
    options?: { timeout?: number },
  ) => Promise<{ id: string; waitForTaskOutput?: (options?: { timeout?: number | null }) => Promise<TaskRetrieveResponse.Succeeded> }>;
};

type ImageToVideoResource = {
  create: (
    body: ImageToVideoCreateParams,
    options?: { timeout?: number },
  ) => Promise<{ id: string; waitForTaskOutput?: (options?: { timeout?: number | null }) => Promise<TaskRetrieveResponse.Succeeded> }>;
};

type DataUriReferenceUploader = (uri: string) => Promise<string>;

function uploadCacheFor(runwayClient: RunwayClient) {
  let cache = runwayUploadCache.get(runwayClient);
  if (!cache) {
    cache = new Map<string, Promise<string>>();
    runwayUploadCache.set(runwayClient, cache);
  }
  return cache;
}

function isOversizedReferenceDataUri(uri: string) {
  return /^data:image\//i.test(uri) && uri.length > RUNWAY_REFERENCE_DATA_URI_MAX_LENGTH;
}

function imageExtensionForMimeType(mimeType: string) {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  return 'jpg';
}

async function uploadDataUriReferenceForRunway(uri: string, runwayClient: RunwayClient) {
  const match = uri.match(/^data:([^;,]+);base64,(.*)$/i);
  if (!match) {
    throw new Error('Cannot upload non-base64 image reference data URI to Runway.');
  }

  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  const file = await toFile(buffer, `reference-${uuidv4()}.${imageExtensionForMimeType(mimeType)}`, { type: mimeType });
  const upload = await runwayClient.uploads.createEphemeral({ file }, { timeout: RUNWAY_TASK_CREATE_TIMEOUT_MS });
  return upload.uri;
}

export async function prepareRunwayReferenceImages(
  referenceImages?: RunwayReferenceImage[],
  uploadReference?: DataUriReferenceUploader,
) {
  if (!referenceImages?.length) return undefined;

  return Promise.all(referenceImages.map(async (image) => {
    if (!isOversizedReferenceDataUri(image.uri)) return image;
    if (!uploadReference) {
      throw new Error('Runway reference upload requires a Runway client.');
    }
    return { ...image, uri: await uploadReference(image.uri) };
  }));
}

export async function createTextToImageTask(
  resource: TextToImageResource,
  params: {
    promptText: string;
    quality: GptImageQuality;
    ratio: GptImage2CreateParams['ratio'];
    referenceImages?: RunwayReferenceImage[];
  },
  uploadReference?: DataUriReferenceUploader,
) {
  const referenceImages = await prepareRunwayReferenceImages(params.referenceImages, uploadReference);
  return resource.create({
    model: IMAGE_MODEL,
    promptText: params.promptText,
    quality: params.quality,
    ratio: params.ratio,
    referenceImages,
  }, { timeout: RUNWAY_TASK_CREATE_TIMEOUT_MS });
}

type RunwayTaskPromise = ReturnType<TextToImageResource['create']>;

export function imageRatio(aspectRatio: AspectRatio): GptImage2CreateParams['ratio'] {
  return aspectRatio === '9:16' ? '1088:1920' : '1920:1088';
}

export function videoRatio(aspectRatio: AspectRatio) {
  return aspectRatio === '9:16' ? '720:1280' : '1280:720';
}

function isVeo31Model(model: string) {
  return model.startsWith('veo3.1');
}

export function runwayVideoRatio(model: string, ratio: ReturnType<typeof videoRatio>): RunwayVideoRatio {
  if (!isVeo31Model(model)) return ratio;
  return ratio === '720:1280' ? '1080:1920' : '1920:1080';
}

export function runwayVideoDuration(model: string, duration: number) {
  if (!isVeo31Model(model)) {
    return Math.max(2, Math.min(10, Math.ceil(duration)));
  }

  const allowedDurations = [4, 6, 8];
  return allowedDurations.reduce((nearest, candidate) => {
    const currentDistance = Math.abs(nearest - duration);
    const candidateDistance = Math.abs(candidate - duration);
    if (candidateDistance < currentDistance) return candidate;
    if (candidateDistance === currentDistance && candidate > nearest) return candidate;
    return nearest;
  }, allowedDurations[0]);
}

export function createImageToVideoTask(
  resource: ImageToVideoResource,
  params: {
    model: string;
    promptImageUri: string;
    promptText: string;
    ratio: ReturnType<typeof videoRatio>;
    duration: number;
  },
) {
  return resource.create({
    model: params.model,
    promptImage: [{ uri: params.promptImageUri, position: 'first' }],
    ratio: runwayVideoRatio(params.model, params.ratio),
    promptText: params.promptText,
    duration: runwayVideoDuration(params.model, params.duration),
  }, { timeout: RUNWAY_TASK_CREATE_TIMEOUT_MS });
}

export async function loadReferenceImage(filePath: string, tag?: string, database: SqliteDatabase = db): Promise<RunwayReferenceImage> {
  const mediaFile = resolveMediaUrlToFilePath(database, filePath);
  const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  const absolutePath = mediaFile?.filePath || path.join(process.cwd(), 'public', normalizedPath);
  const buffer = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).replace('.', '').toLowerCase();
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

function extensionForUploadMimeType(mimeType: string) {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  return 'bin';
}

function runwayUploadFileName(input: { sourcePath: string; mimeType: string; fallbackPath: string }) {
  const baseName = path.basename(input.sourcePath || input.fallbackPath);
  if (path.extname(baseName)) return baseName;

  const fallbackExtension = path.extname(input.fallbackPath).replace('.', '').toLowerCase()
    || extensionForUploadMimeType(input.mimeType);
  const stem = baseName.replace(/\.+$/g, '') || 'upload';
  return `${stem}.${fallbackExtension}`;
}

async function uploadLocalAssetForRunway(localOrRemoteUrl: string, runwayClient: RunwayClient, database: SqliteDatabase = db) {
  if (/^(https?:|runway:)/i.test(localOrRemoteUrl)) {
    return localOrRemoteUrl;
  }

  const mediaFile = resolveMediaUrlToFilePath(database, localOrRemoteUrl);
  const normalizedPath = localOrRemoteUrl.startsWith('/') ? localOrRemoteUrl.slice(1) : localOrRemoteUrl;
  const absolutePath = mediaFile?.filePath || path.join(process.cwd(), 'public', normalizedPath);
  const cache = uploadCacheFor(runwayClient);
  const cached = cache.get(absolutePath);
  if (cached) return cached;

  const uploadPromise = (async () => {
    const buffer = await fs.readFile(absolutePath);
    const mimeType = mediaFile?.asset.mime_type || mimeTypeForLocalPath(absolutePath);
    const fileName = runwayUploadFileName({
      sourcePath: mediaFile?.filePath || normalizedPath,
      mimeType,
      fallbackPath: absolutePath,
    });
    const file = await toFile(buffer, fileName, { type: mimeType });
    const upload = await runwayClient.uploads.createEphemeral({ file }, { timeout: RUNWAY_TASK_CREATE_TIMEOUT_MS });
    return upload.uri;
  })();

  cache.set(absolutePath, uploadPromise);

  try {
    return await uploadPromise;
  } catch (error) {
    cache.delete(absolutePath);
    throw error;
  }
}

async function retryTaskCreation<T>(
  label: string,
  createTask: () => Promise<T>,
  maxAttempts = 3,
  logContext: MediaGenerationLogDetails = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      logMediaGeneration('runway_task_create_attempt', { ...logContext, attempt, maxAttempts, provider: 'runway' });
      return await createTask();
    } catch (error) {
      lastError = error;
      if (isValidationError(error)) {
        logMediaGeneration('runway_task_create_validation_failed', { ...logContext, attempt, maxAttempts, provider: 'runway', error }, 'warn');
        break;
      }
      if (attempt === maxAttempts) break;
      logMediaGeneration('runway_task_create_retry', { ...logContext, attempt, maxAttempts, provider: 'runway', error }, 'warn');
      console.warn(`${label} task creation failed, retrying (${attempt}/${maxAttempts})`, error);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }

  logMediaGeneration('runway_task_create_failed', { ...logContext, maxAttempts, provider: 'runway', error: lastError }, 'error');
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
  runwayClient: RunwayClient,
  timeoutMs = RUNWAY_TASK_WAIT_TIMEOUT_MS,
  logContext: MediaGenerationLogDetails = {},
): Promise<RunwayTaskOutput> {
  const task = await taskPromise;
  logMediaGeneration('runway_task_created', { ...logContext, provider: 'runway', runwayTaskId: task.id });
  if (task.waitForTaskOutput) {
    logMediaGeneration('runway_task_wait_start', { ...logContext, provider: 'runway', runwayTaskId: task.id });
    const output = await task.waitForTaskOutput({ timeout: timeoutMs });
    logMediaGeneration('runway_task_succeeded', { ...logContext, provider: 'runway', runwayTaskId: task.id, outputCount: output.output.length });
    return { output: output.output };
  }

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const current = await runwayClient.tasks.retrieve(task.id);
    if (current.status === 'SUCCEEDED') {
      logMediaGeneration('runway_task_succeeded', { ...logContext, provider: 'runway', runwayTaskId: task.id, outputCount: current.output.length });
      return { output: current.output };
    }
    if (current.status === 'FAILED') {
      logMediaGeneration('runway_task_failed', { ...logContext, provider: 'runway', runwayTaskId: task.id, error: current.failure }, 'error');
      throw new Error(`${label} failed: ${current.failure}`);
    }
    if (current.status === 'CANCELLED') {
      logMediaGeneration('runway_task_cancelled', { ...logContext, provider: 'runway', runwayTaskId: task.id }, 'warn');
      throw new Error(`${label} was cancelled`);
    }
    await new Promise((resolve) => setTimeout(resolve, RUNWAY_TASK_POLL_INTERVAL_MS));
  }

  logMediaGeneration('runway_task_timeout', { ...logContext, provider: 'runway', runwayTaskId: task.id }, 'error');
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

function mimeTypeForGeneratedAsset(contentType: string | null, mediaType: MediaType) {
  if (contentType?.trim()) return contentType;
  if (mediaType === 'image') return 'image/jpeg';
  if (mediaType === 'audio') return 'audio/mpeg';
  return 'video/mp4';
}

export async function persistGeneratedAsset(
  remoteUrl: string,
  mediaType: MediaType,
  sessionId: string,
  logContext: MediaGenerationLogDetails = {},
  database: SqliteDatabase = db,
): Promise<GeneratedAsset> {
  logMediaGeneration('asset_download_start', { ...logContext, sessionId, mediaType, remoteUrl });
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to download generated ${mediaType}: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  const ext = extensionFor(contentType, remoteUrl, mediaType);
  const id = uuidv4();
  const privateFile = createPrivateMediaFilePath({
    scope: 'generated',
    kind: mediaType,
    sessionId,
    id,
    extension: ext,
  });
  const buffer = Buffer.from(await response.arrayBuffer());

  await fs.mkdir(path.dirname(privateFile.absolutePath), { recursive: true });
  await fs.writeFile(privateFile.absolutePath, buffer);
  const mediaAsset = createMediaAssetForSession(database, {
    id,
    sessionId,
    kind: mediaType,
    filePath: privateFile.relativePath,
    mimeType: mimeTypeForGeneratedAsset(contentType, mediaType),
    byteSize: buffer.byteLength,
    originalName: null,
  });
  const localUrl = mediaAssetUrl(mediaAsset.id);

  logMediaGeneration('asset_persisted', {
    ...logContext,
    sessionId,
    mediaType,
    remoteUrl,
    localUrl,
    filePath: privateFile.relativePath,
  });

  return {
    remoteUrl,
    localUrl,
    filePath: privateFile.relativePath,
    mediaType,
    mediaAssetId: mediaAsset.id,
  };
}

export async function generateImageAsset(params: {
  promptText: string;
  quality: GptImageQuality;
  ratio: GptImage2CreateParams['ratio'];
  referenceImages?: RunwayReferenceImage[];
  sessionId: string;
  runwayClient: RunwayClient;
  database?: SqliteDatabase;
  logContext?: MediaGenerationLogDetails;
}) {
  const logContext = {
    ...params.logContext,
    sessionId: params.sessionId,
    mediaType: 'image' as const,
    model: IMAGE_MODEL,
    quality: params.quality,
    ratio: params.ratio,
    referenceImageCount: params.referenceImages?.length || 0,
    promptText: params.promptText,
  };
  const textToImageResource = params.runwayClient.textToImage as unknown as TextToImageResource;
  const task = await waitForOutput(
    retryTaskCreation('Runway image', (): RunwayTaskPromise => createTextToImageTask(textToImageResource, {
      promptText: params.promptText,
      quality: params.quality,
      ratio: params.ratio,
      referenceImages: params.referenceImages?.length ? params.referenceImages : undefined,
    }, (uri) => uploadDataUriReferenceForRunway(uri, params.runwayClient)), 3, logContext),
    'Runway image generation',
    params.runwayClient,
    RUNWAY_TASK_WAIT_TIMEOUT_MS,
    logContext,
  );

  return persistGeneratedAsset(firstOutputUrl(task, 'Runway image generation'), 'image', params.sessionId, logContext, params.database);
}

export async function generateSpeechAsset(params: {
  promptText: string;
  sessionId: string;
  runwayClient: RunwayClient;
  database?: SqliteDatabase;
  logContext?: MediaGenerationLogDetails;
}) {
  const logContext = {
    ...params.logContext,
    sessionId: params.sessionId,
    mediaType: 'audio' as const,
    model: NARRATION_MODEL,
    promptText: params.promptText,
  };
  const task = await waitForOutput(
    retryTaskCreation('Runway TTS', () => params.runwayClient.textToSpeech.create({
      model: NARRATION_MODEL,
      promptText: params.promptText,
      voice: { type: 'runway-preset', presetId: 'Bernard' },
    }, { timeout: RUNWAY_TASK_CREATE_TIMEOUT_MS }), 3, logContext),
    'Runway TTS generation',
    params.runwayClient,
    RUNWAY_TASK_WAIT_TIMEOUT_MS,
    logContext,
  );

  return persistGeneratedAsset(firstOutputUrl(task, 'Runway TTS generation'), 'audio', params.sessionId, logContext, params.database);
}

export async function generateVideoAsset(params: {
  promptImageUrl: string;
  promptText: string;
  ratio: ReturnType<typeof videoRatio>;
  duration: number;
  sessionId: string;
  runwayClient: RunwayClient;
  database?: SqliteDatabase;
  videoModel?: RunwayVideoModel;
  logContext?: MediaGenerationLogDetails;
}) {
  const promptImageUri = await uploadLocalAssetForRunway(params.promptImageUrl, params.runwayClient, params.database);
  const model = params.videoModel || getRunwayVideoModel();
  const logContext = {
    ...params.logContext,
    sessionId: params.sessionId,
    mediaType: 'video' as const,
    model,
    duration: runwayVideoDuration(model, params.duration),
    requestedDuration: params.duration,
    ratio: runwayVideoRatio(model, params.ratio),
    promptImageUrl: params.promptImageUrl,
    promptText: params.promptText,
  };
  const imageToVideoResource = params.runwayClient.imageToVideo as unknown as ImageToVideoResource;
  const task = await waitForOutput(
    retryTaskCreation('Runway video', () => createImageToVideoTask(imageToVideoResource, {
      model,
      promptImageUri,
      promptText: params.promptText,
      ratio: params.ratio,
      duration: params.duration,
    }), 3, logContext),
    'Runway video generation',
    params.runwayClient,
    RUNWAY_TASK_WAIT_TIMEOUT_MS,
    logContext,
  );

  return persistGeneratedAsset(firstOutputUrl(task, 'Runway video generation'), 'video', params.sessionId, logContext, params.database);
}
