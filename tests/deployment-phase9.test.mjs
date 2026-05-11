import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function readText(pathname) {
  return fs.readFileSync(new URL(pathname, import.meta.url), 'utf8');
}

test('Phase 9 Docker image uses Debian runtime packages for Remotion rendering', () => {
  const dockerfile = readText('../Dockerfile');

  assert.match(dockerfile, /FROM node:20-bookworm-slim AS base/);
  assert.doesNotMatch(dockerfile, /node:20-alpine|apk add/);
  assert.match(dockerfile, /apt-get update && apt-get install -y --no-install-recommends/);

  for (const packageName of [
    'ffmpeg',
    'chromium',
    'ca-certificates',
    'fonts-liberation',
    'libnss3',
    'libdbus-1-3',
    'libatk1.0-0',
    'libasound2',
    'libxrandr2',
    'libxkbcommon-dev',
    'libxfixes3',
    'libxcomposite1',
    'libxdamage1',
    'libgbm-dev',
    'libcups2',
    'libcairo2',
    'libpango-1.0-0',
    'libatk-bridge2.0-0',
  ]) {
    assert.match(dockerfile, new RegExp(`\\b${packageName.replace('.', '\\.')}\\b`), `${packageName} should be installed`);
  }

  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\*/);
});

test('Phase 9 Docker defaults keep Remotion conservative on VPS hosts', () => {
  const dockerfile = readText('../Dockerfile');
  const envExample = readText('../.env.example');
  const productionEnvExample = readText('../.env.production.example');

  for (const source of [dockerfile, envExample, productionEnvExample]) {
    assert.match(source, /REMOTION_BROWSER_EXECUTABLE[:=].*\/usr\/bin\/chromium/);
    assert.match(source, /REMOTION_RENDER_QUALITY[:=].*fast/);
    assert.match(source, /REMOTION_CONCURRENCY[:=].*50%/);
    assert.match(source, /REMOTION_TIMEOUT_MS[:=].*900000/);
    assert.match(source, /REMOTION_X264_PRESET[:=].*veryfast/);
    assert.match(source, /REMOTION_BUNDLE_CACHE[:=].*true/);
  }
});

test('Phase 9 final render code consumes Remotion deployment knobs', () => {
  const source = readText('../src/lib/final-render.ts');

  assert.match(source, /REMOTION_RENDER_QUALITY/);
  assert.match(source, /REMOTION_BROWSER_EXECUTABLE/);
  assert.match(source, /REMOTION_CONCURRENCY/);
  assert.match(source, /REMOTION_TIMEOUT_MS/);
  assert.match(source, /REMOTION_X264_PRESET/);
  assert.match(source, /REMOTION_BUNDLE_CACHE/);
  assert.match(source, /selectComposition\(\{[\s\S]*timeoutInMilliseconds/);
  assert.match(source, /renderMedia\(\{[\s\S]*concurrency/);
  assert.match(source, /renderMedia\(\{[\s\S]*x264Preset/);
});

test('Phase 9 standalone build carries LiveKit RPC logger dependencies', () => {
  const config = readText('../next.config.js');

  assert.match(config, /@livekit\/rtc-node/);
  assert.match(config, /@runwayml\/avatars-node-rpc/);
  assert.match(config, /@datastructures-js\/deque/);
  assert.match(config, /@livekit\/mutex/);
  assert.match(config, /@livekit\/typed-emitter/);
  assert.match(config, /pino/);
  assert.match(config, /sonic-boom/);
  assert.match(config, /thread-stream/);
});
