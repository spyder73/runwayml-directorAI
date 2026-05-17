import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});

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

    CREATE TABLE chat_history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE scenes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT,
      scene_index INTEGER NOT NULL,
      narrator_text TEXT NOT NULL,
      visual_prompt TEXT NOT NULL,
      image_prompt TEXT,
      video_prompt TEXT,
      duration REAL,
      narration_duration REAL,
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

  db.prepare('INSERT INTO sessions (id, status, story_text, aspect_ratio, mode, user_name) VALUES (?, ?, ?, ?, ?, ?)')
    .run('session-1', 'OUTLINE_REVIEW', '', '16:9', 'life_story', 'Dorian');

  return db;
}

function seedOutline(db) {
  const {
    applyProfileBucketUpdate,
    initializeStoryBucketTables,
    loadStoryBucket,
    proposeFilmTreatment,
    proposeSceneOutline,
  } = jiti('../src/lib/story-bucket.ts');

  initializeStoryBucketTables(db);
  applyProfileBucketUpdate(db, 'session-1', {
    profile: {
      protagonistName: 'Dorian',
      profession: 'Student of Quantum Technology',
      currentLocation: 'Krakow',
      summary: 'Dorian studies quantum technology after a difficult but formative physics chapter in Aachen.',
    },
    memoryCandidates: [
      {
        title: 'The Breaking Point in Aachen',
        description: 'Dorian starts physics in Aachen, studies with Lenos, and eventually breaks against abstract theory.',
        emotionalPurpose: 'Show the shift from academic ambition to a more self-directed path.',
        visualSummary: 'Aachen study rooms, notebooks, diagrams, and late-night cooking with Lenos.',
        people: ['Dorian', 'Lenos'],
        places: ['Aachen'],
      },
    ],
  });
  proposeFilmTreatment(db, 'session-1', {
    title: 'The Subatomic Shift',
    emotionalThesis: 'Clarity arrives through friction, friendship, danger, music, and focused building.',
    narrativeArc: 'Aachen struggle to Albania survival to festival connection to Krakow focus.',
    visualMotif: 'Light moving from harsh analytical blue into warmer lived texture.',
    narratorStyle: 'Introspective and grounded.',
    endingFeeling: 'A quiet readiness to build something real.',
    avoid: ['generic academic montage'],
  });
  proposeSceneOutline(db, 'session-1', {
    scenes: [
      {
        title: 'The Breaking Point in Aachen',
        summary: 'Dorian struggles with abstract theoretical physics in Aachen and realizes he needs a different path.',
        narratorText: 'In Aachen, the diagrams became a wall, and the wall became a choice.',
        imagePrompt: 'Dorian studies at a cluttered Aachen desk under cool computer light.',
        videoPrompt: 'The camera slowly pushes toward Dorian as he sets down his pencil.',
        duration: 5,
        emotionalPurpose: 'Establish the academic pivot.',
        protagonistVisible: true,
      },
      {
        title: 'Surviving Albania',
        summary: 'Dorian and Moritz survive a demanding kayak journey through Albania.',
        narratorText: 'Then the water asked a simpler question: can you keep moving?',
        imagePrompt: 'A kayak on rough Albanian water under storm light.',
        videoPrompt: 'The camera tracks low over waves as the kayak fights forward.',
        duration: 6,
        emotionalPurpose: 'Contrast theory with physical survival.',
        protagonistVisible: true,
      },
    ],
  });

  return loadStoryBucket(db, 'session-1');
}

function revisedAachenPayload() {
  return JSON.stringify({
    revisionStatus: 'updated',
    revisionMessage: 'I expanded the Aachen section into a clearer short sequence.',
    scenes: [
      {
        title: 'The Academic Beginning',
        summary: 'Dorian arrives in Aachen with real curiosity and commits himself to studying physics.',
        narratorText: 'Aachen began with belief: that the world could be understood if he stayed with the questions.',
        imagePrompt: 'Dorian walks into an Aachen university building with notebooks under his arm.',
        videoPrompt: 'The camera follows behind Dorian as he enters the university hallway.',
        duration: 4,
        emotionalPurpose: 'Show the hopeful start.',
        protagonistVisible: true,
      },
      {
        title: 'Partners in Pursuit',
        summary: 'Dorian and Lenos push through homework, lab courses, cooking, and long philosophical nights.',
        narratorText: 'With Lenos, the struggle became shared: equations, food, and impossible conversations after midnight.',
        imagePrompt: 'Dorian and Lenos study at a kitchen table in Aachen with notes and a small pot nearby.',
        videoPrompt: 'The camera drifts around the table as their hands move between notebooks and dinner.',
        duration: 5,
        emotionalPurpose: 'Make Lenos part of the academic chapter.',
        protagonistVisible: true,
      },
      {
        title: 'The Breaking Point',
        summary: 'The Hugenholtz diagrams overwhelm Dorian and clarify that pure theory is not his future.',
        narratorText: 'Then the diagrams stopped being a doorway and became a wall he did not want to worship.',
        imagePrompt: 'Dorian faces a whiteboard full of difficult theoretical physics diagrams.',
        videoPrompt: 'The camera shifts focus from tangled diagrams to Dorian lowering his eyes.',
        duration: 5,
        emotionalPurpose: 'Preserve the original pivot.',
        protagonistVisible: true,
      },
      {
        title: 'Surviving Albania',
        summary: 'Dorian and Moritz survive a demanding kayak journey through Albania.',
        narratorText: 'Then the water asked a simpler question: can you keep moving?',
        imagePrompt: 'A kayak on rough Albanian water under storm light.',
        videoPrompt: 'The camera tracks low over waves as the kayak fights forward.',
        duration: 6,
        emotionalPurpose: 'Contrast theory with physical survival.',
        protagonistVisible: true,
      },
    ],
  });
}

test('AI outline revision replaces the full outline without writing interview chat', async () => {
  const db = createDb();
  const bucketBefore = seedOutline(db);
  const { loadStoryBucket, lockSceneOutlineForProduction } = jiti('../src/lib/story-bucket.ts');
  const { reviseOutlineWithAi } = jiti('../src/lib/outline-revision.ts');

  const target = bucketBefore.sceneOutline.find((scene) => scene.title === 'The Breaking Point in Aachen');
  assert.ok(target);

  const result = await reviseOutlineWithAi(db, 'session-1', {
    sceneOutlineId: target.id,
    comment: 'you can make more scenes out of this shortly introducing me how i start studying physics in aachen and am pushing through it with lenos',
  }, {
    generateRevisionText: async ({ prompt }) => {
      assert.match(prompt, /make more scenes out of this/i);
      assert.match(prompt, /The Breaking Point in Aachen/);
      assert.match(prompt, /Lenos/);
      return revisedAachenPayload();
    },
  });

  assert.equal(result.revisionStatus, 'updated');
  assert.match(result.revisionMessage, /expanded/i);

  const bucketAfter = loadStoryBucket(db, 'session-1');
  const titles = bucketAfter.sceneOutline.map((scene) => scene.title);
  assert.ok(titles.indexOf('The Academic Beginning') < titles.indexOf('Partners in Pursuit'));
  assert.ok(titles.indexOf('Partners in Pursuit') < titles.indexOf('The Breaking Point'));
  assert.equal(titles.includes('The Breaking Point in Aachen'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_history').get().count, 0);

  lockSceneOutlineForProduction(db, 'session-1');
  const productionTitles = db.prepare('SELECT title FROM scenes WHERE session_id = ? ORDER BY scene_index ASC')
    .all('session-1')
    .map((row) => row.title);

  assert.equal(productionTitles.includes('Partners in Pursuit'), true);
  assert.equal(productionTitles.includes('The Breaking Point in Aachen'), false);
});

test('AI outline revision can ask for inline clarification without replacing the outline', async () => {
  const db = createDb();
  const bucketBefore = seedOutline(db);
  const { loadStoryBucket } = jiti('../src/lib/story-bucket.ts');
  const { reviseOutlineWithAi } = jiti('../src/lib/outline-revision.ts');

  const target = bucketBefore.sceneOutline.find((scene) => scene.title === 'The Breaking Point in Aachen');
  const beforeTitles = bucketBefore.sceneOutline.map((scene) => scene.title);

  const result = await reviseOutlineWithAi(db, 'session-1', {
    sceneOutlineId: target.id,
    comment: 'make this more accurate',
  }, {
    generateRevisionText: async () => JSON.stringify({
      revisionStatus: 'needs_clarification',
      question: 'Which Aachen moment should lead the split: arriving at university, studying with Lenos, or the Hugenholtz diagrams?',
    }),
  });

  assert.equal(result.revisionStatus, 'needs_clarification');
  assert.match(result.question, /Aachen moment/);
  assert.deepEqual(loadStoryBucket(db, 'session-1').sceneOutline.map((scene) => scene.title), beforeTitles);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_history').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM scene_outline_comments').get().count, 1);
});

test('outline revision logs request, generation, and persisted scene list when conversation logs are enabled', async () => {
  const previousEnabled = process.env.LOG_CONVERSATIONS;
  const previousDir = process.env.CONVERSATION_LOG_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifestory-outline-revision-'));
  try {
    process.env.LOG_CONVERSATIONS = 'true';
    process.env.CONVERSATION_LOG_DIR = tempDir;
    const db = createDb();
    const bucketBefore = seedOutline(db);
    const { conversationLogPathForSession } = jiti('../src/lib/conversation-logs.ts');
    const { reviseOutlineWithAi } = jiti('../src/lib/outline-revision.ts');
    const target = bucketBefore.sceneOutline.find((scene) => scene.title === 'The Breaking Point in Aachen');

    await reviseOutlineWithAi(db, 'session-1', {
      sceneOutlineId: target.id,
      comment: 'split this into a beginning and a friendship beat',
    }, {
      generateRevisionText: async () => revisedAachenPayload(),
    });

    const events = fs.readFileSync(conversationLogPathForSession('session-1'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    assert.equal(events.some((event) => event.event === 'outline_revision_requested'), true);
    assert.equal(events.some((event) => event.event === 'outline_revision_generated'), true);
    const persisted = events.find((event) => event.event === 'outline_revision_persisted');
    assert.ok(persisted);
    assert.deepEqual(
      persisted.metadata.titles.filter((title) => /Academic Beginning|Partners in Pursuit/.test(title)),
      ['The Academic Beginning', 'Partners in Pursuit'],
    );
    assert.ok(persisted.metadata.scenes.length >= persisted.metadata.titles.length);
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.LOG_CONVERSATIONS;
    } else {
      process.env.LOG_CONVERSATIONS = previousEnabled;
    }
    if (previousDir === undefined) {
      delete process.env.CONVERSATION_LOG_DIR;
    } else {
      process.env.CONVERSATION_LOG_DIR = previousDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
