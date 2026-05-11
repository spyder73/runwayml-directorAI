import fs from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

const manifestPath = process.argv[2];

if (!manifestPath) {
  throw new Error('Missing render manifest path.');
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const publicDir = '/workspace/public';
await fs.mkdir(publicDir, { recursive: true });
await fs.mkdir(path.dirname(manifest.outputMountedPath), { recursive: true });

const serveUrl = await bundle({
  entryPoint: manifest.entryPoint,
  publicDir,
  enableCaching: true,
});

const selectedComposition = await selectComposition({
  serveUrl,
  id: manifest.composition.id,
  inputProps: manifest.inputProps,
  browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || '/usr/bin/chromium',
  timeoutInMilliseconds: manifest.renderOptions.timeoutInMilliseconds,
  logLevel: 'warn',
});

await renderMedia({
  serveUrl,
  composition: {
    ...selectedComposition,
    width: manifest.composition.width,
    height: manifest.composition.height,
    fps: manifest.composition.fps,
    durationInFrames: manifest.composition.durationInFrames,
  },
  inputProps: manifest.inputProps,
  codec: 'h264',
  outputLocation: manifest.outputMountedPath,
  overwrite: true,
  crf: manifest.renderOptions.crf,
  pixelFormat: 'yuv420p',
  browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || '/usr/bin/chromium',
  concurrency: manifest.renderOptions.concurrency,
  timeoutInMilliseconds: manifest.renderOptions.timeoutInMilliseconds,
  x264Preset: manifest.renderOptions.x264Preset,
  logLevel: 'warn',
});
