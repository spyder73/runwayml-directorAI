import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('Phase 8 rate limiter allows a bounded window then resets', () => {
  const {
    checkRateLimit,
    resetRateLimitsForTests,
  } = jiti('../src/lib/rate-limit.ts');

  resetRateLimitsForTests();
  assert.deepEqual(checkRateLimit('login:ip:127.0.0.1', { limit: 2, windowMs: 1000, now: 100 }), {
    allowed: true,
    limit: 2,
    remaining: 1,
    resetAt: 1100,
    retryAfterSeconds: 1,
  });
  assert.equal(checkRateLimit('login:ip:127.0.0.1', { limit: 2, windowMs: 1000, now: 200 }).allowed, true);

  const blocked = checkRateLimit('login:ip:127.0.0.1', { limit: 2, windowMs: 1000, now: 300 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSeconds, 1);

  assert.equal(checkRateLimit('login:ip:127.0.0.1', { limit: 2, windowMs: 1000, now: 1201 }).allowed, true);
});

test('Phase 8 upload validator rejects empty, non-image, svg, oversized, and too many files', () => {
  const {
    MAX_UPLOAD_FILE_BYTES,
    MAX_UPLOAD_FILES,
    validateUploadFiles,
  } = jiti('../src/lib/upload-limits.ts');

  assert.equal(validateUploadFiles([{ name: 'selfie.jpg', size: 128, type: 'image/jpeg' }]), null);
  assert.match(validateUploadFiles([{ name: 'empty.jpg', size: 0, type: 'image/jpeg' }])?.message || '', /empty/i);
  assert.match(validateUploadFiles([{ name: 'notes.txt', size: 128, type: 'text/plain' }])?.message || '', /image/i);
  assert.match(validateUploadFiles([{ name: 'vector.svg', size: 128, type: 'image/svg+xml' }])?.message || '', /image/i);
  assert.match(validateUploadFiles([{ name: 'huge.jpg', size: MAX_UPLOAD_FILE_BYTES + 1, type: 'image/jpeg' }])?.message || '', /25 MB/i);
  assert.match(
    validateUploadFiles(Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, index) => ({
      name: `photo-${index}.jpg`,
      size: 128,
      type: 'image/jpeg',
    })))?.message || '',
    /too many/i,
  );
});

test('Phase 8 render locks prevent duplicate session renders and global parallel renders', async () => {
  const {
    getActiveFinalRenderSession,
    releaseFinalRenderLock,
    resetLocksForTests,
    startFinalRenderWithLock,
    tryAcquireFinalRenderLock,
  } = jiti('../src/lib/locks.ts');

  resetLocksForTests();
  assert.equal(tryAcquireFinalRenderLock('session-1'), true);
  assert.equal(getActiveFinalRenderSession(), 'session-1');
  assert.equal(tryAcquireFinalRenderLock('session-1'), false);
  assert.equal(tryAcquireFinalRenderLock('session-2'), false);
  releaseFinalRenderLock('session-1');
  assert.equal(tryAcquireFinalRenderLock('session-2'), true);
  releaseFinalRenderLock('session-2');

  let ran = false;
  const started = startFinalRenderWithLock('session-3', async () => {
    ran = true;
  });
  assert.equal(started, true);
  assert.equal(startFinalRenderWithLock('session-4', async () => {}), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ran, true);
  assert.equal(getActiveFinalRenderSession(), null);
});

test('Phase 8 routes are wired through rate limits, upload limits, and render locks', () => {
  const routeSources = {
    login: '../src/app/api/auth/login/route.ts',
    register: '../src/app/api/auth/register/route.ts',
    resend: '../src/app/api/auth/resend-verification/route.ts',
    start: '../src/app/api/pipeline/start/route.ts',
    demo: '../src/app/api/pipeline/demo/route.ts',
    outline: '../src/app/api/pipeline/outline/route.ts',
    synthesize: '../src/app/api/pipeline/synthesize/route.ts',
    retry: '../src/app/api/pipeline/retry/route.ts',
    render: '../src/app/api/pipeline/render/route.ts',
    upload: '../src/app/api/pipeline/upload/route.ts',
  };

  for (const [name, sourcePath] of Object.entries(routeSources)) {
    const source = fs.readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
    assert.match(source, /rate-limit/, `${name} should import rate-limit helpers`);
    assert.match(source, /rateLimitResponse/, `${name} should return 429 responses`);
  }

  const uploadSource = fs.readFileSync(new URL('../src/app/api/pipeline/upload/route.ts', import.meta.url), 'utf8');
  assert.match(uploadSource, /validateUploadFiles/);
  assert.match(uploadSource, /UPLOAD_RATE_LIMIT/);

  const renderSource = fs.readFileSync(new URL('../src/app/api/pipeline/render/route.ts', import.meta.url), 'utf8');
  assert.match(renderSource, /startFinalRenderWithLock/);
  assert.match(renderSource, /alreadyRunning/);

  const retrySource = fs.readFileSync(new URL('../src/app/api/pipeline/retry/route.ts', import.meta.url), 'utf8');
  assert.match(retrySource, /startFinalRenderWithLock/);
  assert.match(retrySource, /alreadyRunning/);
});
