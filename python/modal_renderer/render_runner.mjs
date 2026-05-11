import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

const WORKDIR = '/workspace';
const BASE_PUBLIC_DIR = path.join(WORKDIR, 'public');

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safePublicAssetPath(value) {
  const raw = String(value || '').replace(/^\/+/, '');
  const normalized = path.posix.normalize(raw);

  if (
    !raw ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.includes('\0')
  ) {
    throw new Error(`Unsafe Remotion public asset path: ${value}`);
  }

  return normalized;
}

function publicAssetTarget(publicDir, publicPath) {
  return path.join(publicDir, ...safePublicAssetPath(publicPath).split('/'));
}

function jobIdForManifest(manifest) {
  return String(manifest?.jobId || 'render').replace(/[^a-zA-Z0-9._-]/g, '_') || 'render';
}

function publicPathForMountedPath(jobId, mountedPath) {
  return path.posix.join('modal-inputs', jobId, path.posix.basename(mountedPath));
}

function publicUrlForPublicPath(publicPath) {
  return `/public/${publicPath}`;
}

function rewriteLegacyFileUrls(value, jobId, inputAssetsByMountedPath) {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteLegacyFileUrls(item, jobId, inputAssetsByMountedPath));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      rewriteLegacyFileUrls(item, jobId, inputAssetsByMountedPath),
    ]));
  }

  if (typeof value !== 'string' || !value.startsWith('file://')) {
    return value;
  }

  let mountedPath;
  try {
    mountedPath = fileURLToPath(value);
  } catch {
    return value;
  }

  const publicPath = publicPathForMountedPath(jobId, mountedPath);
  inputAssetsByMountedPath.set(mountedPath, { mountedPath, publicPath });
  return publicUrlForPublicPath(publicPath);
}

export function prepareManifestForRender(manifest) {
  const jobId = jobIdForManifest(manifest);
  const inputAssetsByMountedPath = new Map();

  for (const asset of Array.isArray(manifest.inputAssets) ? manifest.inputAssets : []) {
    const mountedPath = String(asset?.mountedPath || '');
    const publicPath = String(asset?.publicPath || '');
    if (mountedPath && publicPath) {
      inputAssetsByMountedPath.set(mountedPath, { mountedPath, publicPath });
    }
  }

  return {
    ...manifest,
    inputProps: rewriteLegacyFileUrls(manifest.inputProps, jobId, inputAssetsByMountedPath),
    inputAssets: [...inputAssetsByMountedPath.values()],
  };
}

async function stageFile(sourcePath, targetPath) {
  const realSourcePath = await fs.realpath(sourcePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rm(targetPath, { force: true, recursive: true });

  try {
    await fs.link(realSourcePath, targetPath);
  } catch {
    await fs.copyFile(realSourcePath, targetPath);
  }
}

async function stageDirectory(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const stat = await fs.stat(sourcePath);

    if (stat.isDirectory()) {
      await stageDirectory(await fs.realpath(sourcePath), targetPath);
      return;
    }

    if (stat.isFile()) {
      await stageFile(sourcePath, targetPath);
    }
  }));
}

async function stageBasePublicEntries(basePublicDir, publicDir) {
  if (!(await pathExists(basePublicDir))) {
    return;
  }

  await stageDirectory(basePublicDir, publicDir);
}

export async function stagePublicAssets({
  publicDir,
  basePublicDir = BASE_PUBLIC_DIR,
  inputAssets = [],
}) {
  await fs.rm(publicDir, { recursive: true, force: true });
  await fs.mkdir(publicDir, { recursive: true });
  await stageBasePublicEntries(basePublicDir, publicDir);

  for (const asset of inputAssets) {
    const mountedPath = String(asset?.mountedPath || '');
    if (!path.isAbsolute(mountedPath)) {
      throw new Error(`Modal input asset must use an absolute mounted path: ${mountedPath}`);
    }

    const stat = await fs.stat(mountedPath);
    if (!stat.isFile()) {
      throw new Error(`Modal input asset must be a file: ${mountedPath}`);
    }

    await stageFile(mountedPath, publicAssetTarget(publicDir, asset?.publicPath));
  }

  return publicDir;
}

export function publicDirForManifest(manifest) {
  return path.join('/tmp', 'remotion-public', jobIdForManifest(manifest));
}

export async function renderFromManifest(manifest) {
  const preparedManifest = prepareManifestForRender(manifest);
  const publicDir = await stagePublicAssets({
    publicDir: publicDirForManifest(preparedManifest),
    inputAssets: preparedManifest.inputAssets,
  });
  await fs.mkdir(path.dirname(preparedManifest.outputMountedPath), { recursive: true });

  const serveUrl = await bundle({
    entryPoint: preparedManifest.entryPoint,
    publicDir,
    enableCaching: true,
    onSymlinkDetected: () => {},
  });

  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || '/usr/bin/chromium';
  const selectedComposition = await selectComposition({
    serveUrl,
    id: preparedManifest.composition.id,
    inputProps: preparedManifest.inputProps,
    browserExecutable,
    timeoutInMilliseconds: preparedManifest.renderOptions.timeoutInMilliseconds,
    logLevel: 'warn',
  });

  await renderMedia({
    serveUrl,
    composition: {
      ...selectedComposition,
      width: preparedManifest.composition.width,
      height: preparedManifest.composition.height,
      fps: preparedManifest.composition.fps,
      durationInFrames: preparedManifest.composition.durationInFrames,
    },
    inputProps: preparedManifest.inputProps,
    codec: 'h264',
    outputLocation: preparedManifest.outputMountedPath,
    overwrite: true,
    crf: preparedManifest.renderOptions.crf,
    pixelFormat: 'yuv420p',
    browserExecutable,
    concurrency: preparedManifest.renderOptions.concurrency,
    timeoutInMilliseconds: preparedManifest.renderOptions.timeoutInMilliseconds,
    x264Preset: preparedManifest.renderOptions.x264Preset,
    logLevel: 'warn',
  });
}

async function main(manifestPath) {
  if (!manifestPath) {
    throw new Error('Missing render manifest path.');
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  await renderFromManifest(manifest);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv[2]);
}
