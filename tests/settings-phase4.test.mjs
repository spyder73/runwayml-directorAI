import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const testDataDir = mkdtempSync(path.join(tmpdir(), 'lifestory-settings-'));
process.env.LIFESTORY_DB_PATH = path.join(testDataDir, 'lifestory.sqlite');
process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
delete process.env.REVIEWER_EMAIL;
delete process.env.REVIEWER_PASSWORD;

function resetSettingsDb(db) {
  db.prepare('DELETE FROM auth_sessions').run();
  db.prepare('DELETE FROM user_api_credentials').run();
  db.prepare('DELETE FROM user_settings').run();
  db.prepare('DELETE FROM users').run();
}

function insertConfirmedUser(db, id = 'settings-user') {
  db.prepare(`
    INSERT INTO users (id, email, password_hash, email_confirmed_at)
    VALUES (?, ?, ?, ?)
  `).run(id, `${id}@example.com`, 'placeholder-hash', '2026-05-10T12:00:00.000Z');
  db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(id);
}

test('credential encryption uses AES-GCM envelopes and never stores the raw key', () => {
  const { decryptCredential, encryptCredential } = jiti('../src/lib/crypto/credentials.ts');

  const first = encryptCredential('sk-live-openrouter');
  const second = encryptCredential('sk-live-openrouter');

  assert.equal(decryptCredential(first), 'sk-live-openrouter');
  assert.equal(decryptCredential(second), 'sk-live-openrouter');
  assert.notEqual(first.encrypted, 'sk-live-openrouter');
  assert.notEqual(first.encrypted, second.encrypted);
  assert.notEqual(first.iv, second.iv);
  assert.equal(Buffer.from(first.iv, 'base64url').length, 12);
  assert.equal(Buffer.from(first.tag, 'base64url').length, 16);
});

test('settings route summarizes saved keys, encrypts updates, and rejects invalid modes', async () => {
  const dbModule = jiti('../src/lib/db.ts');
  const db = dbModule.default;
  resetSettingsDb(db);
  insertConfirmedUser(db);

  const route = jiti('../src/app/api/settings/route.ts');
  const { AUTH_SESSION_COOKIE, createAuthSession } = jiti('../src/lib/auth/session.ts');
  const { decryptCredential } = jiti('../src/lib/crypto/credentials.ts');
  const authSession = createAuthSession(db, 'settings-user');
  const cookie = `${AUTH_SESSION_COOKIE}=${authSession.token}`;

  const unauthenticated = await route.GET(new Request('https://lifestory.example/api/settings'));
  assert.equal(unauthenticated.status, 401);

  const initial = await route.GET(new Request('https://lifestory.example/api/settings', {
    headers: { cookie },
  }));
  assert.equal(initial.status, 200);
  assert.deepEqual(await initial.json(), {
    openrouterKeySaved: false,
    runwayKeySaved: false,
    runwayConcurrencyMode: 'serial',
    runwayVideoModel: 'gen4_turbo',
  });

  const saved = await route.PUT(new Request('https://lifestory.example/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      openrouterApiKey: 'openrouter-user-key',
      runwayApiKey: 'runway-user-key',
      runwayConcurrencyMode: 'parallel',
      runwayVideoModel: 'veo3.1_fast',
    }),
  }));
  assert.equal(saved.status, 200);
  const savedJson = await saved.json();
  assert.deepEqual(savedJson, {
    openrouterKeySaved: true,
    runwayKeySaved: true,
    runwayConcurrencyMode: 'parallel',
    runwayVideoModel: 'veo3.1_fast',
  });
  assert.equal(JSON.stringify(savedJson).includes('openrouter-user-key'), false);
  assert.equal(JSON.stringify(savedJson).includes('runway-user-key'), false);

  const credentials = db.prepare('SELECT * FROM user_api_credentials WHERE user_id = ?').get('settings-user');
  assert.notEqual(credentials.openrouter_key_encrypted, 'openrouter-user-key');
  assert.notEqual(credentials.runway_key_encrypted, 'runway-user-key');
  assert.equal(decryptCredential({
    encrypted: credentials.openrouter_key_encrypted,
    iv: credentials.openrouter_key_iv,
    tag: credentials.openrouter_key_tag,
  }), 'openrouter-user-key');
  assert.equal(decryptCredential({
    encrypted: credentials.runway_key_encrypted,
    iv: credentials.runway_key_iv,
    tag: credentials.runway_key_tag,
  }), 'runway-user-key');

  const invalidMode = await route.PUT(new Request('https://lifestory.example/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ runwayConcurrencyMode: 'turbo' }),
  }));
  assert.equal(invalidMode.status, 400);

  const invalidModel = await route.PUT(new Request('https://lifestory.example/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ runwayVideoModel: 'gen4_aleph' }),
  }));
  assert.equal(invalidModel.status, 400);
});

test('session UI exposes a settings cog and never hydrates raw saved keys into fields', () => {
  const source = readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /Settings/);
  assert.match(source, /SettingsModal/);
  assert.match(source, /setIsSettingsOpen\(true\)/);

  const modalSource = readFileSync(new URL('../src/components/session/SettingsModal.tsx', import.meta.url), 'utf8');
  assert.match(modalSource, /\/api\/settings/);
  assert.match(modalSource, /openrouterApiKey/);
  assert.match(modalSource, /runwayApiKey/);
  assert.match(modalSource, /runwayConcurrencyMode/);
  assert.match(modalSource, /runwayVideoModel/);
  assert.match(modalSource, /Sequential/);
  assert.match(modalSource, /step by step/);
  assert.match(modalSource, /throttle/i);
  assert.match(modalSource, /veo3\.1_fast/);
  assert.match(modalSource, /gen4_turbo/);
  assert.match(modalSource, /user-supplied keys/i);
  assert.doesNotMatch(modalSource, /value=\{summary\.openrouter/i);
  assert.doesNotMatch(modalSource, /value=\{summary\.runway/i);
});

test('home page exposes a top-right settings cog after login', () => {
  const source = readFileSync(new URL('../src/components/home/StudioHome.tsx', import.meta.url), 'utf8');

  assert.match(source, /Settings/);
  assert.match(source, /SettingsModal/);
  assert.match(source, /isSettingsOpen/);
  assert.match(source, /setIsSettingsOpen\(true\)/);
  assert.match(source, /fixed right-6 top-6/);
  assert.match(source, /aria-label="Open settings"/);
});
