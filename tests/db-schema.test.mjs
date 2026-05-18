import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const testDataDir = mkdtempSync(path.join(tmpdir(), 'lifestory-db-'));
process.env.LIFESTORY_DB_PATH = path.join(testDataDir, 'lifestory.sqlite');

const dbModule = jiti('../src/lib/db.ts');
dbModule.default?.close?.();

const { initializeDatabaseSchema } = dbModule;

function names(rows) {
  return new Set(rows.map((row) => row.name));
}

function tableNames(db) {
  return names(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all());
}

function columnNames(db, tableName) {
  return names(db.prepare(`PRAGMA table_info(${tableName})`).all());
}

function indexNames(db, tableName) {
  return names(db.prepare(`PRAGMA index_list(${tableName})`).all());
}

test('production schema creates auth, credentials, settings, media, and ownership structures', () => {
  assert.equal(typeof initializeDatabaseSchema, 'function');

  const db = new Database(':memory:');
  initializeDatabaseSchema(db);
  initializeDatabaseSchema(db);

  const tables = tableNames(db);
  for (const tableName of [
    'sessions',
    'users',
    'auth_sessions',
    'email_verification_tokens',
    'user_api_credentials',
    'user_settings',
    'media_assets',
  ]) {
    assert.equal(tables.has(tableName), true, `missing table ${tableName}`);
  }

  const sessionColumns = columnNames(db, 'sessions');
  assert.equal(sessionColumns.has('user_id'), true);
  assert.equal(sessionColumns.has('final_video_media_asset_id'), true);
  assert.equal(sessionColumns.has('interview_medium'), true);
  assert.equal(sessionColumns.has('render_notification_email'), true);

  for (const tableName of [
    'avatar_call_sessions',
    'avatar_call_events',
  ]) {
    assert.equal(tables.has(tableName), true, `missing table ${tableName}`);
  }

  assert.deepEqual([...columnNames(db, 'users')].sort(), [
    'created_at',
    'email',
    'email_confirmed_at',
    'id',
    'password_hash',
    'updated_at',
  ]);

  for (const column of [
    'openrouter_key_encrypted',
    'openrouter_key_iv',
    'openrouter_key_tag',
    'runway_key_encrypted',
    'runway_key_iv',
    'runway_key_tag',
  ]) {
    assert.equal(columnNames(db, 'user_api_credentials').has(column), true, `missing credential column ${column}`);
  }

  const mediaColumns = columnNames(db, 'media_assets');
  for (const column of ['id', 'user_id', 'session_id', 'kind', 'file_path', 'mime_type', 'byte_size', 'original_name']) {
    assert.equal(mediaColumns.has(column), true, `missing media column ${column}`);
  }
  assert.equal(columnNames(db, 'media_tasks').has('auto_failure_notification_sent_at'), true);

  assert.equal(indexNames(db, 'sessions').has('idx_sessions_user_id'), true);
  assert.equal(indexNames(db, 'media_assets').has('idx_media_assets_owner'), true);
  assert.equal(indexNames(db, 'auth_sessions').has('idx_auth_sessions_user'), true);

  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('user-1', 'reviewer@example.com', 'hash');
  db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run('user-1');
  assert.equal(columnNames(db, 'user_settings').has('runway_video_model'), true);

  const settings = db.prepare('SELECT runway_concurrency_mode, runway_video_model FROM user_settings WHERE user_id = ?').get('user-1');
  assert.equal(settings.runway_concurrency_mode, 'serial');
  assert.equal(settings.runway_video_model, 'gen4_turbo');

  db.close();
});

test('production schema preserves pre-auth sessions with null ownership columns', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'life_story',
      status TEXT NOT NULL,
      story_text TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      clarify_question TEXT,
      user_name TEXT,
      user_age TEXT,
      user_selfie_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare('INSERT INTO sessions (id, status, story_text, aspect_ratio, mode) VALUES (?, ?, ?, ?, ?)')
    .run('legacy-session', 'INTERVIEW_ONBOARDING', '', '16:9', 'life_story');

  initializeDatabaseSchema(db);
  initializeDatabaseSchema(db);

  const sessionColumns = columnNames(db, 'sessions');
  assert.equal(sessionColumns.has('user_id'), true);
  assert.equal(sessionColumns.has('final_video_media_asset_id'), true);
  assert.equal(sessionColumns.has('interview_medium'), true);
  assert.equal(sessionColumns.has('render_notification_email'), true);

  const legacySession = db.prepare('SELECT user_id, final_video_media_asset_id, interview_medium, render_notification_email FROM sessions WHERE id = ?')
    .get('legacy-session');
  assert.deepEqual(legacySession, {
    user_id: null,
    final_video_media_asset_id: null,
    interview_medium: 'text',
    render_notification_email: null,
  });

  db.close();
});
