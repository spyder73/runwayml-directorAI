import fs from 'fs/promises';
import path from 'path';
import type { FinalRenderPlan } from './final-render';

type RemotionConcurrency = number | string | null;

export type ModalRenderOptions = {
  crf: number;
  x264Preset: string;
  timeoutInMilliseconds?: number;
  concurrency?: RemotionConcurrency;
};

export type ModalRenderRequest = {
  appName: string;
  functionName: string;
  volumeName: string;
  outputLocalPath: string;
  inputFiles: Array<{
    localPath: string;
    volumePath: string;
  }>;
  manifest: {
    jobId: string;
    entryPoint: string;
    composition: FinalRenderPlan['composition'];
    inputProps: FinalRenderPlan['remotionInputProps'];
    inputAssets: Array<{
      mountedPath: string;
      publicPath: string;
    }>;
    outputVolumePath: string;
    outputMountedPath: string;
    renderOptions: ModalRenderOptions;
  };
};

type ModalRenderRequestOptions = {
  appName: string;
  functionName: string;
  volumeName: string;
  volumeMountPath: string;
  jobId: string;
  renderOptions: ModalRenderOptions;
};

type ModalRenderEnv = {
  [key: string]: string | undefined;
  MODAL_RENDER_APP_NAME?: string;
  MODAL_RENDER_FUNCTION_NAME?: string;
  MODAL_RENDER_VOLUME?: string;
  MODAL_RENDER_VOLUME_MOUNT_PATH?: string;
  MODAL_RENDER_BRIDGE_URL?: string;
  MODAL_RENDER_BRIDGE_PORT?: string;
};

type ModalRenderBridgeResult = {
  ok?: boolean;
  outputLocalPath?: string;
  byteSize?: number;
  error?: string;
};

const DEFAULT_MODAL_APP_NAME = 'lifestory-remotion-renderer';
const DEFAULT_MODAL_FUNCTION_NAME = 'render_final';
const DEFAULT_MODAL_VOLUME = 'lifestory-render-jobs';
const DEFAULT_MODAL_VOLUME_MOUNT_PATH = '/render-data';
const DEFAULT_MODAL_BRIDGE_PORT = '8765';
const REMOTE_REPO_ROOT = '/workspace';

function safeJobId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'job';
}

function volumePath(...parts: string[]) {
  return `/${path.posix.join(...parts.map((part) => part.replace(/^\/+|\/+$/g, '')))}`;
}

function mountedFilePath(mountPath: string, remotePath: string) {
  return path.posix.join(mountPath, remotePath.replace(/^\/+/, ''));
}

function publicFilePath(jobId: string, remotePath: string) {
  return path.posix.join('modal-inputs', jobId, path.posix.basename(remotePath));
}

function remotionPublicUrl(publicPath: string) {
  return `/public/${publicPath}`;
}

function remoteRemotionEntryPoint(entryPoint: string) {
  const relative = path.relative(process.cwd(), entryPoint);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.posix.join(REMOTE_REPO_ROOT, 'src/remotion/Root.tsx');
  }

  return path.posix.join(REMOTE_REPO_ROOT, relative.split(path.sep).join(path.posix.sep));
}

function extensionForInput(inputPath: string) {
  return path.extname(inputPath).replace(/[^a-zA-Z0-9.]/g, '').toLowerCase() || '.bin';
}

function remapInputProps(
  plan: FinalRenderPlan,
  urlMap: Map<string, string>,
): FinalRenderPlan['remotionInputProps'] {
  return {
    scenes: plan.remotionInputProps.scenes.map((scene) => ({
      ...scene,
      clips: scene.clips.map((clip) => ({
        ...clip,
        url: urlMap.get(clip.url) || clip.url,
      })),
      audio_url: scene.audio_url ? (urlMap.get(scene.audio_url) || scene.audio_url) : '',
    })),
  };
}

export function modalRenderBridgeUrl(env: ModalRenderEnv = process.env) {
  const configured = env.MODAL_RENDER_BRIDGE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const port = env.MODAL_RENDER_BRIDGE_PORT?.trim() || DEFAULT_MODAL_BRIDGE_PORT;
  return `http://127.0.0.1:${port}`;
}

export function modalRenderConfig(env: ModalRenderEnv = process.env) {
  return {
    appName: env.MODAL_RENDER_APP_NAME?.trim() || DEFAULT_MODAL_APP_NAME,
    functionName: env.MODAL_RENDER_FUNCTION_NAME?.trim() || DEFAULT_MODAL_FUNCTION_NAME,
    volumeName: env.MODAL_RENDER_VOLUME?.trim() || DEFAULT_MODAL_VOLUME,
    volumeMountPath: env.MODAL_RENDER_VOLUME_MOUNT_PATH?.trim() || DEFAULT_MODAL_VOLUME_MOUNT_PATH,
    bridgeUrl: modalRenderBridgeUrl(env),
  };
}

export function buildModalRenderRequest(
  plan: FinalRenderPlan,
  options: ModalRenderRequestOptions,
): ModalRenderRequest {
  const jobId = safeJobId(options.jobId);
  const inputFiles: ModalRenderRequest['inputFiles'] = [];
  const inputAssets: ModalRenderRequest['manifest']['inputAssets'] = [];
  const urlMap = new Map<string, string>();
  const localPathToVolumePath = new Map<string, string>();
  const inputs = [...plan.videoInputs, ...plan.audioInputs];

  for (const input of inputs) {
    let remotePath = localPathToVolumePath.get(input.filePath);
    if (!remotePath) {
      const index = localPathToVolumePath.size;
      remotePath = volumePath('jobs', jobId, 'inputs', `input-${String(index).padStart(3, '0')}${extensionForInput(input.filePath)}`);
      localPathToVolumePath.set(input.filePath, remotePath);
      inputFiles.push({
        localPath: input.filePath,
        volumePath: remotePath,
      });
      inputAssets.push({
        mountedPath: mountedFilePath(options.volumeMountPath, remotePath),
        publicPath: publicFilePath(jobId, remotePath),
      });
    }

    urlMap.set(input.remotionUrl, remotionPublicUrl(publicFilePath(jobId, remotePath)));
  }

  const outputVolumePath = volumePath('jobs', jobId, 'output', 'final.mp4');

  return {
    appName: options.appName,
    functionName: options.functionName,
    volumeName: options.volumeName,
    outputLocalPath: plan.outputFilePath,
    inputFiles,
    manifest: {
      jobId,
      entryPoint: remoteRemotionEntryPoint(plan.entryPoint),
      composition: plan.composition,
      inputProps: remapInputProps(plan, urlMap),
      inputAssets,
      outputVolumePath,
      outputMountedPath: path.posix.join(options.volumeMountPath, outputVolumePath.replace(/^\/+/, '')),
      renderOptions: options.renderOptions,
    },
  };
}

async function readBridgeJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as ModalRenderBridgeResult;
  } catch {
    return { error: text };
  }
}

export async function runModalRenderBridge(request: ModalRenderRequest, bridgeUrl: string) {
  await fs.mkdir(path.dirname(request.outputLocalPath), { recursive: true });

  console.log(JSON.stringify({
    scope: 'modal-render-bridge',
    message: 'request-start',
    bridgeUrl,
    appName: request.appName,
    functionName: request.functionName,
    inputCount: request.inputFiles.length,
    outputLocalPath: request.outputLocalPath,
  }));

  const response = await fetch(`${bridgeUrl.replace(/\/+$/, '')}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const data = await readBridgeJson(response);

  if (!response.ok || data.ok === false) {
    console.error(JSON.stringify({
      scope: 'modal-render-bridge',
      message: 'request-failed',
      status: response.status,
      error: data.error || null,
    }));
    throw new Error(data.error || `Modal render bridge failed with HTTP ${response.status}`);
  }

  console.log(JSON.stringify({
    scope: 'modal-render-bridge',
    message: 'request-completed',
    status: response.status,
    outputLocalPath: data.outputLocalPath || request.outputLocalPath,
    byteSize: data.byteSize ?? null,
  }));

  return {
    outputLocalPath: data.outputLocalPath || request.outputLocalPath,
    byteSize: data.byteSize ?? null,
  };
}
