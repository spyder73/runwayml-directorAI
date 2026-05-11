import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

const ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function withCredentialEnv(fn) {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = ENCRYPTION_KEY;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
    }
  }
}

function createProductionDb() {
  const { initializeDatabaseSchema } = jiti('../src/lib/db.ts');
  const db = new Database(':memory:');
  initializeDatabaseSchema(db);
  return db;
}

function insertUser(db, userId = 'user-1') {
  db.prepare(`
    INSERT INTO users (id, email, password_hash, email_confirmed_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(userId, `${userId}@example.com`, 'hash');
  return userId;
}

function insertSession(db, sessionId = 'session-1', userId = 'user-1') {
  db.prepare(`
    INSERT INTO sessions (id, user_id, status, story_text, aspect_ratio, mode)
    VALUES (?, ?, 'INTERVIEW_DYNAMIC', '', '16:9', 'life_story')
  `).run(sessionId, userId);
  return sessionId;
}

function insertEncryptedCredentials(db, userId, values) {
  const { encryptCredential } = jiti('../src/lib/crypto/credentials.ts');
  const openrouter = values.openrouter ? encryptCredential(values.openrouter) : null;
  const runway = values.runway ? encryptCredential(values.runway) : null;

  db.prepare(`
    INSERT INTO user_api_credentials (
      user_id,
      openrouter_key_encrypted,
      openrouter_key_iv,
      openrouter_key_tag,
      runway_key_encrypted,
      runway_key_iv,
      runway_key_tag
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    openrouter?.encrypted || null,
    openrouter?.iv || null,
    openrouter?.tag || null,
    runway?.encrypted || null,
    runway?.iv || null,
    runway?.tag || null,
  );
}

test('Phase 6 provider credentials decrypt per user and expose safe missing-key errors', () => withCredentialEnv(() => {
  const db = createProductionDb();
  insertUser(db);
  const sessionId = insertSession(db);
  insertEncryptedCredentials(db, 'user-1', {
    openrouter: 'sk-or-user-1',
    runway: 'rw-user-1',
  });
  db.prepare(`
    INSERT INTO user_settings (user_id, runway_concurrency_mode)
    VALUES (?, ?)
  `).run('user-1', 'parallel');

  const {
    MISSING_BYOK_MESSAGE,
    MissingUserCredentialError,
    getUserProviderCredentials,
    getRunwayConcurrencyModeForSession,
    requireOpenRouterApiKeyForSession,
    requireRunwayApiKeyForSession,
  } = jiti('../src/lib/providers/user-credentials.ts');

  const credentials = getUserProviderCredentials(db, 'user-1');
  assert.deepEqual(credentials, {
    openrouterApiKey: 'sk-or-user-1',
    runwayApiKey: 'rw-user-1',
    runwayConcurrencyMode: 'parallel',
  });
  assert.equal(requireOpenRouterApiKeyForSession(db, sessionId), 'sk-or-user-1');
  assert.equal(requireRunwayApiKeyForSession(db, sessionId), 'rw-user-1');
  assert.equal(getRunwayConcurrencyModeForSession(db, sessionId), 'parallel');

  insertUser(db, 'user-2');
  insertSession(db, 'session-2', 'user-2');
  assert.throws(
    () => requireOpenRouterApiKeyForSession(db, 'session-2'),
    (error) => error instanceof MissingUserCredentialError
      && error.message === MISSING_BYOK_MESSAGE
      && error.provider === 'openrouter',
  );
}));

test('Phase 6 source removes module-scope provider clients and global provider API keys', () => {
  const sources = [
    'src/lib/ai.ts',
    'src/lib/pipeline.ts',
    'src/lib/shot_planner.ts',
    'src/lib/moderation.ts',
    'src/app/api/pipeline/upload/route.ts',
    'src/app/api/pipeline/director/route.ts',
  ];

  for (const sourcePath of sources) {
    const source = fs.readFileSync(new URL(`../${sourcePath}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /const\s+openrouter\s*=\s*createOpenRouter/);
    assert.doesNotMatch(source, /process\.env\.OPENROUTER_API_KEY/);
  }

  const runwaySource = fs.readFileSync(new URL('../src/lib/runway.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(runwaySource, /const\s+runway\s*=\s*new\s+RunwayML/);
  assert.doesNotMatch(runwaySource, /process\.env\.RUNWAYML_API_SECRET/);

  const credentialSource = fs.readFileSync(new URL('../src/lib/providers/user-credentials.ts', import.meta.url), 'utf8');
  assert.match(credentialSource, /createOpenRouter/);
  assert.match(credentialSource, /new RunwayML/);
});

test('media task runner uses the owning user runway concurrency setting by default', async () => {
  const { createMediaTask } = jiti('../src/lib/media-tasks.ts');
  const { runMediaTaskRunner } = jiti('../src/lib/pipeline_media.ts');

  const db = createProductionDb();
  insertUser(db);
  insertSession(db);
  db.prepare(`
    INSERT INTO user_settings (user_id, runway_concurrency_mode)
    VALUES (?, ?)
  `).run('user-1', 'parallel');

  createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_scene_frame',
    provider: 'runway',
  });
  createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-2',
    kind: 'generate_scene_frame',
    provider: 'runway',
  });

  let active = 0;
  let maxActive = 0;
  const result = await runMediaTaskRunner('session-1', {
    database: db,
    onlyKinds: ['generate_scene_frame'],
    executors: {
      generate_scene_frame: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return `frame-${Date.now()}`;
      },
    },
  });

  assert.equal(result.failed, 0);
  assert.equal(result.succeeded, 2);
  assert.equal(maxActive, 2);
});
