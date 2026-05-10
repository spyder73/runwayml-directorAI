import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function readText(pathname) {
  return fs.readFileSync(new URL(pathname, import.meta.url), 'utf8');
}

test('Phase 10 production compose exposes web only to the shared proxy network', () => {
  const compose = readText('../docker-compose.yml');

  assert.match(compose, /env_file:\s*\n\s*-\s*\.env\.production/);
  assert.match(compose, /expose:\s*\n\s*-\s*"3000"/);
  assert.match(compose, /restart:\s*unless-stopped/);
  assert.match(compose, /networks:\s*\n\s*-\s*proxy/);
  assert.match(compose, /proxy:\s*\n\s*external:\s*true/);
  assert.match(compose, /-\s*\.\/data:\/app\/data/);

  assert.doesNotMatch(compose, /^\s*ports:/m);
  assert.doesNotMatch(compose, /["']?(?:0\.0\.0\.0:)?(?:80|443):/);
  assert.doesNotMatch(compose, /3000:3000/);
  assert.doesNotMatch(compose, /public\/uploads|public\/generated/);
});

test('Phase 10 localhost compose override binds only loopback debug port', () => {
  const compose = readText('../docker-compose.localhost.yml');

  assert.match(compose, /127\.0\.0\.1:3001:3000/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:|["']?(?:80|443):/);
});

test('Phase 10 production env example contains deployment placeholders only', () => {
  const gitignore = readText('../.gitignore');
  const env = readText('../.env.production.example');

  assert.match(gitignore, /!\.env\.production\.example/);

  for (const line of [
    'NODE_ENV=production',
    'APP_URL=https://your-new-domain.com',
    'SESSION_SECRET=generate-with-openssl-rand-base64-32',
    'CREDENTIAL_ENCRYPTION_KEY=generate-with-openssl-rand-base64-32',
    'MEDIA_STORAGE_DIR=/app/data/media',
    'SMTP_HOST=smtp.example.com',
    'SMTP_PORT=587',
    'SMTP_USER=your-smtp-user',
    'SMTP_PASS=your-smtp-password',
    'SMTP_FROM="Lifestory <no-reply@your-new-domain.com>"',
    'REVIEWER_EMAIL=',
    'REVIEWER_PASSWORD=',
    'REVIEWER_OPENROUTER_API_KEY=',
    'REVIEWER_RUNWAYML_API_SECRET=',
    'REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium',
    'REMOTION_RENDER_QUALITY=fast',
    'REMOTION_CONCURRENCY=50%',
    'REMOTION_TIMEOUT_MS=900000',
    'REMOTION_X264_PRESET=veryfast',
    'REMOTION_BUNDLE_CACHE=true',
  ]) {
    assert.match(env, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.doesNotMatch(env, /sk-or-v1-|key_[a-f0-9]{16,}/i);
});
