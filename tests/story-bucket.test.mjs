import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  applyProfileBucketUpdate,
  createReferenceAsset,
  createReferenceUploadRequest,
  hasProtagonistReferenceDecision,
  initializeStoryBucketTables,
  loadStoryBucket,
  lockSceneOutlineForProduction,
  proposeSceneOutline,
} = jiti('../src/lib/story-bucket.ts');

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
      is_protagonist_visible BOOLEAN DEFAULT 1
    );
  `);

  db.prepare('INSERT INTO sessions (id, status, story_text, aspect_ratio, mode) VALUES (?, ?, ?, ?, ?)')
    .run('session-1', 'INTERVIEW_ONBOARDING', '', '16:9', 'life_story');

  initializeStoryBucketTables(db);
  return db;
}

test('profile bucket update persists profile, entities, themes, and memory candidates', () => {
  const db = createDb();

  applyProfileBucketUpdate(db, 'session-1', {
    profile: {
      protagonistName: 'Maya',
      age: '41',
      lifePhase: 'starting over in a new city',
      emotionalTone: 'hopeful but guarded',
      themes: ['belonging', 'reinvention'],
      summary: 'Maya is rebuilding a life around a quieter kind of courage.',
    },
    entities: [
      {
        type: 'person',
        displayName: 'Aunt Lena',
        relationship: 'raised Maya after school',
        description: 'Warm, exacting, always smelled faintly of cedar.',
        consentState: 'unknown',
      },
    ],
    memoryCandidates: [
      {
        title: 'The bus station goodbye',
        description: 'Maya leaving home with one suitcase.',
        emotionalPurpose: 'the first break from the old life',
        visualSummary: 'fluorescent lights, wet pavement, blue suitcase',
        referencesNeeded: ['protagonist', 'bus station'],
      },
    ],
  });

  const bucket = loadStoryBucket(db, 'session-1');

  assert.equal(bucket.profile?.protagonist_name, 'Maya');
  assert.equal(bucket.profile?.age, '41');
  assert.deepEqual(JSON.parse(bucket.profile?.themes_json || '[]'), ['belonging', 'reinvention']);
  assert.equal(bucket.entities[0]?.display_name, 'Aunt Lena');
  assert.equal(bucket.memoryCandidates[0]?.title, 'The bus station goodbye');
});

test('reference assets get stable unique tags and attach to active requests', () => {
  const db = createDb();

  const first = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/maya.jpg',
    targetType: 'protagonist',
    targetLabel: 'Maya',
    visionDescription: 'A woman in a green coat, soft window light.',
    usagePermissions: 'allowed',
  });

  const second = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/maya-2.jpg',
    targetType: 'protagonist',
    targetLabel: 'Maya',
    visionDescription: 'Another portrait of Maya.',
    usagePermissions: 'allowed',
  });

  assert.match(first.stable_tag, /^[a-z][a-z0-9_]+$/);
  assert.match(second.stable_tag, /^[a-z][a-z0-9_]+$/);
  assert.notEqual(first.stable_tag, second.stable_tag);
});

test('protagonist reference decision is true after upload request, upload, or description', () => {
  const db = createDb();

  assert.equal(hasProtagonistReferenceDecision(db, 'session-1'), false);

  createReferenceUploadRequest(db, 'session-1', {
    targetType: 'protagonist',
    targetLabel: 'Maya',
    promptText: 'Would you like to add a photo of yourself?',
  });

  assert.equal(hasProtagonistReferenceDecision(db, 'session-1'), true);
});

test('opening protagonist request can be shown without leaving onboarding', () => {
  const db = createDb();

  createReferenceUploadRequest(db, 'session-1', {
    targetType: 'protagonist',
    targetLabel: 'Maya',
    promptText: 'Would you like to add a photo of yourself?',
  }, { updateSessionStatus: false });

  const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1');
  assert.equal(session.status, 'INTERVIEW_ONBOARDING');
  assert.equal(hasProtagonistReferenceDecision(db, 'session-1'), true);
});

test('locking an outline creates production scenes and moves session to image generation', () => {
  const db = createDb();

  proposeSceneOutline(db, 'session-1', {
    scenes: [
      {
        title: 'Opening the suitcase',
        summary: 'Maya opens the suitcase in a rented room.',
        narratorText: 'She arrived with almost nothing, which made every object feel chosen.',
        imagePrompt: 'A cinematic rented room with a blue suitcase open on the bed.',
        videoPrompt: 'Slow push toward the suitcase as morning light crosses the room.',
        duration: 6,
        emotionalPurpose: 'beginning again',
        referenceNeeds: ['protagonist'],
        protagonistVisible: true,
      },
    ],
  });

  const result = lockSceneOutlineForProduction(db, 'session-1');
  const scene = db.prepare('SELECT * FROM scenes WHERE session_id = ?').get('session-1');
  const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1');

  assert.equal(result.createdScenes, 1);
  assert.equal(scene.narrator_text, 'She arrived with almost nothing, which made every object feel chosen.');
  assert.equal(scene.scene_references, '["protagonist"]');
  assert.equal(session.status, 'GENERATING_IMAGES');
});
