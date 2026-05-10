import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

function createDb() {
  const { initializeDatabaseSchema } = jiti('../src/lib/db.ts');
  const db = new Database(':memory:');
  initializeDatabaseSchema(db);
  return db;
}

function withReviewerEnv(env, fn) {
  const previous = {
    CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
    REVIEWER_EMAIL: process.env.REVIEWER_EMAIL,
    REVIEWER_PASSWORD: process.env.REVIEWER_PASSWORD,
    REVIEWER_OPENROUTER_API_KEY: process.env.REVIEWER_OPENROUTER_API_KEY,
    REVIEWER_RUNWAYML_API_SECRET: process.env.REVIEWER_RUNWAYML_API_SECRET,
  };

  Object.assign(process.env, env);

  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test('reviewer seed is idempotent, confirmed, and stores encrypted reviewer keys', async () => {
  await withReviewerEnv({
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    REVIEWER_EMAIL: ' Reviewer@Example.COM ',
    REVIEWER_PASSWORD: 'reviewer-secret',
    REVIEWER_OPENROUTER_API_KEY: 'openrouter-live-key',
    REVIEWER_RUNWAYML_API_SECRET: 'runway-live-key',
  }, async () => {
    const db = createDb();
    const { seedReviewerAccount } = jiti('../src/lib/auth/seed-reviewer.ts');
    const { decryptCredential } = jiti('../src/lib/crypto/credentials.ts');
    const { verifyPassword } = jiti('../src/lib/auth/password.ts');

    const first = await seedReviewerAccount(db);
    const second = await seedReviewerAccount(db);

    assert.equal(first.seeded, true);
    assert.equal(second.seeded, true);
    assert.equal(first.userId, second.userId);

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('reviewer@example.com');
    assert.equal(user.id, first.userId);
    assert.match(user.email_confirmed_at, /^\d{4}-\d{2}-\d{2}/);
    assert.equal(await verifyPassword('reviewer-secret', user.password_hash), true);

    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(user.id);
    assert.equal(settings.runway_concurrency_mode, 'serial');

    const credentials = db.prepare('SELECT * FROM user_api_credentials WHERE user_id = ?').get(user.id);
    assert.notEqual(credentials.openrouter_key_encrypted, 'openrouter-live-key');
    assert.notEqual(credentials.runway_key_encrypted, 'runway-live-key');
    assert.equal(decryptCredential({
      encrypted: credentials.openrouter_key_encrypted,
      iv: credentials.openrouter_key_iv,
      tag: credentials.openrouter_key_tag,
    }), 'openrouter-live-key');
    assert.equal(decryptCredential({
      encrypted: credentials.runway_key_encrypted,
      iv: credentials.runway_key_iv,
      tag: credentials.runway_key_tag,
    }), 'runway-live-key');

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').get('reviewer@example.com').count, 1);
  });
});

test('reviewer seed updates changed reviewer password without logging secrets', async () => {
  await withReviewerEnv({
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
    REVIEWER_EMAIL: 'reviewer@example.com',
    REVIEWER_PASSWORD: 'initial-secret',
  }, async () => {
    const db = createDb();
    const { seedReviewerAccount } = jiti('../src/lib/auth/seed-reviewer.ts');
    const { verifyPassword } = jiti('../src/lib/auth/password.ts');

    const first = await seedReviewerAccount(db);
    process.env.REVIEWER_PASSWORD = 'updated-secret';
    const second = await seedReviewerAccount(db);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(first.userId);

    assert.equal(second.userId, first.userId);
    assert.equal(await verifyPassword('updated-secret', user.password_hash), true);
    assert.equal(await verifyPassword('initial-secret', user.password_hash), false);
  });
});

test('database startup calls reviewer seed without exposing secret values in source', () => {
  const dbSource = fs.readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
  const seedSource = fs.readFileSync(new URL('../src/lib/auth/seed-reviewer.ts', import.meta.url), 'utf8');

  assert.match(dbSource, /seedReviewerAccount\(db\)/);
  assert.doesNotMatch(seedSource, /console\.(log|warn|error)\([^)]*REVIEWER_PASSWORD/);
  assert.doesNotMatch(seedSource, /console\.(log|warn|error)\([^)]*API_KEY/);
});
