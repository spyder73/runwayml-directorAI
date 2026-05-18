import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const scriptPath = new URL('../scripts/recover-runway-shot.mjs', import.meta.url);

function createRecoveryDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-runway-shot-'));
  const dbPath = path.join(dir, 'lifestory.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT, status TEXT, updated_at DATETIME);
    CREATE TABLE scenes (id TEXT PRIMARY KEY, session_id TEXT, scene_index INTEGER, shot_plan_json TEXT, video_url TEXT, status TEXT, last_failure TEXT);
    CREATE TABLE user_api_credentials (user_id TEXT, runway_key_encrypted TEXT, runway_key_iv TEXT, runway_key_tag TEXT);
    CREATE TABLE media_assets (id TEXT, user_id TEXT, session_id TEXT, kind TEXT, file_path TEXT, mime_type TEXT, byte_size INTEGER, original_name TEXT);
    CREATE TABLE media_tasks (session_id TEXT, scene_id TEXT, kind TEXT, status TEXT, output_asset_id TEXT, completed_at DATETIME, last_error TEXT);
  `);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run('session-1', 'user-1', 'GENERATING_FINAL_ASSETS');
  db.prepare('INSERT INTO scenes VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'scene-1',
    'session-1',
    0,
    JSON.stringify([{ prompt: 'scene one shot', url: '/api/media/old-scene-1', status: 'succeeded' }]),
    JSON.stringify(['/api/media/old-scene-1']),
    'completed',
    null,
  );
  db.prepare('INSERT INTO scenes VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'scene-2',
    'session-1',
    1,
    JSON.stringify([
      { prompt: 'first', url: '/api/media/old-scene-2-shot-1', status: 'succeeded' },
      { prompt: 'second', status: 'running', reference_image_url: '/api/media/frame' },
    ]),
    null,
    'generating_video',
    null,
  );
  db.prepare('INSERT INTO media_assets VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'new-video',
    'user-1',
    'session-1',
    'video',
    'generated/video/session-1/new-video.mp4',
    'video/mp4',
    123,
    null,
  );
  db.close();
  return { dbPath, dir };
}

function runRecovery(args) {
  return execFileSync(process.execPath, [scriptPath.pathname, ...args], {
    encoding: 'utf8',
  });
}

test('recover script inspect mode lists incomplete sub-scenes', () => {
  const { dbPath } = createRecoveryDb();

  const output = runRecovery(['--db-path', dbPath, '--session-id', 'session-1', '--inspect']);

  assert.match(output, /Scene 2 \(scene-2\), sub-scene 2/);
  assert.match(output, /status=running/);
});

test('recover script batch mode links existing media assets to multiple shots', () => {
  const { dbPath, dir } = createRecoveryDb();
  const batchPath = path.join(dir, 'recover-map.json');
  fs.writeFileSync(batchPath, JSON.stringify([
    { sceneIndex: 2, shotIndex: 2, mediaAssetId: 'new-video' },
  ]));

  const output = runRecovery(['--db-path', dbPath, '--session-id', 'session-1', '--batch-file', batchPath]);

  assert.match(output, /Recovered 1 shot/);

  const db = new Database(dbPath);
  const scene = db.prepare('SELECT status, video_url, shot_plan_json FROM scenes WHERE id = ?').get('scene-2');
  const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1');
  db.close();

  assert.equal(scene.status, 'completed');
  assert.equal(scene.video_url, JSON.stringify(['/api/media/old-scene-2-shot-1', '/api/media/new-video']));
  assert.deepEqual(JSON.parse(scene.shot_plan_json).map((shot) => shot.status), ['succeeded', 'succeeded']);
  assert.equal(session.status, 'PREVIEW_READY');
});
