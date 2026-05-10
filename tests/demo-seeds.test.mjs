import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

function createDb() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'life_story',
      status TEXT NOT NULL,
      story_text TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      clarify_question TEXT,
      user_name TEXT,
      user_age TEXT,
      user_selfie_url TEXT,
      final_video_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE scenes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      scene_index INTEGER NOT NULL,
      narrator_text TEXT NOT NULL,
      visual_prompt TEXT NOT NULL,
      image_prompt TEXT,
      video_prompt TEXT,
      duration INTEGER,
      scene_references TEXT,
      reference_image_url TEXT,
      video_url TEXT,
      audio_url TEXT,
      status TEXT DEFAULT 'pending',
      is_protagonist_visible BOOLEAN DEFAULT 1,
      reference_tags TEXT,
      shot_plan_json TEXT,
      retry_attempts INTEGER DEFAULT 0,
      last_failure TEXT
    );
  `);

  return db;
}

test('demo memory seed creates a bounded outline with short narrator text', () => {
  const { createDemoMemorySeed } = jiti('../src/lib/demo-seeds.ts');
  const { initializeStoryBucketTables, loadStoryBucket } = jiti('../src/lib/story-bucket.ts');
  const db = createDb();
  initializeStoryBucketTables(db);

  const seeded = createDemoMemorySeed(db, { aspectRatio: '9:16' });
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(seeded.sessionId);
  const bucket = loadStoryBucket(db, seeded.sessionId);
  const totalDuration = bucket.sceneOutline.reduce((total, scene) => total + scene.duration, 0);

  assert.equal(session.mode, 'single_memory');
  assert.equal(session.aspect_ratio, '9:16');
  assert.equal(session.status, 'OUTLINE_REVIEW');
  assert.equal(bucket.treatment?.title, 'The Platform Light');
  assert.equal(bucket.sceneOutline.length, 4);
  assert.ok(totalDuration >= 20);
  assert.ok(totalDuration <= 40);
  assert.ok(bucket.sceneOutline.every((scene) => scene.narrator_text.length <= 140));
});
