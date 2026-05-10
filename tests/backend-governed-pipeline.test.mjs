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
      title TEXT,
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

  db.prepare('INSERT INTO sessions (id, status, story_text, aspect_ratio, mode) VALUES (?, ?, ?, ?, ?)')
    .run('session-1', 'INTERVIEW_DYNAMIC', '', '16:9', 'single_memory');

  return db;
}

test('prompt linting rejects unsynchronized image reference tags before credits are spent', () => {
  const { lintRunwayImagePrompt } = jiti('../src/lib/prompt-lint.ts');

  const result = lintRunwayImagePrompt({
    promptText: '@self waits under yellow station lights with a blue suitcase.',
    referenceImages: [
      { tag: 'self', uri: 'data:image/jpeg;base64,abc' },
      { tag: 'station_01', uri: 'data:image/jpeg;base64,def' },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /station_01/);
});

test('prompt linting rejects video prompts without motion and invalid durations', () => {
  const { lintRunwayVideoPrompt } = jiti('../src/lib/prompt-lint.ts');

  const result = lintRunwayVideoPrompt({
    promptText: 'A quiet cinematic portrait of Maya in warm kitchen light.',
    durationSeconds: 12,
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /motion/i);
  assert.match(result.errors.join('\n'), /2 and 10/);
});

test('video prompt repair adds camera motion before runway validation', () => {
  const {
    ensureRunwayVideoPromptMotion,
    lintRunwayVideoPrompt,
  } = jiti('../src/lib/prompt-lint.ts');

  const promptText = ensureRunwayVideoPromptMotion('A quiet cinematic portrait of Maya in warm kitchen light.');
  const result = lintRunwayVideoPrompt({ promptText, durationSeconds: 6 });

  assert.equal(result.ok, true);
  assert.match(promptText, /camera/i);
});

test('cost estimator uses gpt_image_2 low sketches and high final frames', () => {
  const { estimateProductionCost } = jiti('../src/lib/cost-estimator.ts');

  const estimate = estimateProductionCost({
    mode: 'single_memory',
    sketchCount: 1,
    scenes: [
      { durationSeconds: 8, narratorText: 'This is a short remembered moment.' },
      { durationSeconds: 7, narratorText: 'It ends quietly, with gratitude.' },
    ],
  });

  assert.equal(estimate.sketchCredits, 1);
  assert.equal(estimate.sceneFrameCredits, 40);
  assert.equal(estimate.videoCredits, 75);
  assert.equal(estimate.totalVideoSeconds, 15);
  assert.equal(estimate.withinDemoLimit, true);
});

test('transition guards refuse production without treatment, approval, or complete outline', () => {
  const { canLockOutline } = jiti('../src/lib/pipeline-guards.ts');

  const blocked = canLockOutline({
    mode: 'single_memory',
    userApprovedOutline: false,
    treatmentReady: false,
    consentChecksPassed: true,
    scenes: [
      {
        narratorText: 'A short line.',
        imagePrompt: 'A cinematic kitchen memory.',
        videoPrompt: 'The camera slowly pushes toward the kitchen table.',
        durationSeconds: 6,
      },
    ],
  });

  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.reasons.sort(), ['outline not approved', 'treatment missing'].sort());
});

test('film treatment persists as the required bridge before outline lock', () => {
  const {
    getFilmTreatment,
    initializeStoryBucketTables,
    loadStoryBucket,
    proposeFilmTreatment,
  } = jiti('../src/lib/story-bucket.ts');

  const db = createDb();
  initializeStoryBucketTables(db);

  const treatment = proposeFilmTreatment(db, 'session-1', {
    title: 'The Suitcase I Carried',
    emotionalThesis: 'Leaving home before knowing what home meant.',
    narrativeArc: 'departure to loneliness to self-invention',
    visualMotif: 'doorways and train windows',
    narratorStyle: 'quiet documentary warmth',
    endingFeeling: 'gratitude without triumph',
    avoid: ['generic city montage'],
  });

  assert.equal(treatment.title, 'The Suitcase I Carried');
  assert.deepEqual(JSON.parse(treatment.avoid_json), ['generic city montage']);
  assert.equal(getFilmTreatment(db, 'session-1')?.visual_motif, 'doorways and train windows');
  assert.equal(loadStoryBucket(db, 'session-1').treatment?.title, 'The Suitcase I Carried');
});

test('media task DAG selects only dependency-ready queued tasks and tracks retries', () => {
  const {
    createMediaTask,
    failMediaTask,
    initializeMediaTaskTables,
    selectRunnableMediaTasks,
  } = jiti('../src/lib/media-tasks.ts');

  const db = createDb();
  initializeMediaTaskTables(db);

  const frame = createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_scene_frame',
    provider: 'runway',
  });
  createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_video_shot',
    provider: 'runway',
    dependsOnTaskIds: [frame.id],
  });

  assert.deepEqual(selectRunnableMediaTasks(db, 'session-1').map((task) => task.id), [frame.id]);

  failMediaTask(db, frame.id, 'temporary runway failure');
  const failed = db.prepare('SELECT status, attempts, last_error FROM media_tasks WHERE id = ?').get(frame.id);

  assert.equal(failed.status, 'failed');
  assert.equal(failed.attempts, 1);
  assert.match(failed.last_error, /temporary/);
});

test('media task rows can be requeued for intentional scene revisions', () => {
  const {
    completeMediaTask,
    createMediaTask,
    initializeMediaTaskTables,
    requeueMediaTasks,
  } = jiti('../src/lib/media-tasks.ts');

  const db = createDb();
  initializeMediaTaskTables(db);

  const video = createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_video_shot',
    provider: 'runway',
  });
  completeMediaTask(db, video.id, '/generated/video/session-1/old.mp4');

  requeueMediaTasks(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_video_shot',
    clearOutput: true,
  });

  const task = db.prepare('SELECT status, attempts, output_asset_id, last_error, completed_at FROM media_tasks WHERE id = ?').get(video.id);
  assert.equal(task.status, 'queued');
  assert.equal(task.attempts, 0);
  assert.equal(task.output_asset_id, null);
  assert.equal(task.last_error, null);
  assert.equal(task.completed_at, null);
});

test('media task runner executes dependency-ready production tasks and leaves render queued', async () => {
  const {
    createMediaTask,
    initializeMediaTaskTables,
  } = jiti('../src/lib/media-tasks.ts');
  const { runMediaTaskRunner } = jiti('../src/lib/pipeline_media.ts');

  const db = createDb();
  initializeMediaTaskTables(db);

  const frame = createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_scene_frame',
    provider: 'runway',
  });
  const narration = createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_narration',
    provider: 'runway',
  });
  const video = createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_video_shot',
    provider: 'runway',
    dependsOnTaskIds: [frame.id, narration.id],
  });
  createMediaTask(db, {
    sessionId: 'session-1',
    kind: 'render_final',
    provider: 'local',
    dependsOnTaskIds: [video.id],
  });

  const executed = [];
  const result = await runMediaTaskRunner('session-1', {
    database: db,
    includeRender: false,
    executors: {
      generate_scene_frame: async () => {
        executed.push('frame');
        return 'frame-url';
      },
      generate_narration: async () => {
        executed.push('narration');
        return 'audio-url';
      },
      generate_video_shot: async () => {
        executed.push('video');
        return 'video-url';
      },
      render_final: async () => {
        executed.push('render');
        return 'final-url';
      },
    },
  });

  const tasks = db.prepare('SELECT kind, status, output_asset_id FROM media_tasks ORDER BY created_at ASC').all();
  assert.equal(result.failed, 0);
  assert.equal(result.succeeded, 3);
  assert.deepEqual(new Set(executed), new Set(['frame', 'narration', 'video']));
  assert.ok(executed.indexOf('video') > executed.indexOf('frame'));
  assert.ok(executed.indexOf('video') > executed.indexOf('narration'));
  assert.deepEqual(tasks.map((task) => [task.kind, task.status, task.output_asset_id]), [
    ['generate_scene_frame', 'succeeded', 'frame-url'],
    ['generate_narration', 'succeeded', 'audio-url'],
    ['generate_video_shot', 'succeeded', 'video-url'],
    ['render_final', 'queued', null],
  ]);
  assert.equal(db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1').status, 'PREVIEW_READY');
});

test('media task runner defaults to serial runway task execution', async () => {
  const {
    createMediaTask,
    initializeMediaTaskTables,
  } = jiti('../src/lib/media-tasks.ts');
  const { runMediaTaskRunner } = jiti('../src/lib/pipeline_media.ts');

  const db = createDb();
  initializeMediaTaskTables(db);

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

  assert.equal(result.succeeded, 2);
  assert.equal(maxActive, 1);
});

test('media task runner can opt into parallel runway task execution', async () => {
  const {
    createMediaTask,
    initializeMediaTaskTables,
  } = jiti('../src/lib/media-tasks.ts');
  const { runMediaTaskRunner } = jiti('../src/lib/pipeline_media.ts');

  const db = createDb();
  initializeMediaTaskTables(db);

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
  await runMediaTaskRunner('session-1', {
    database: db,
    onlyKinds: ['generate_scene_frame'],
    concurrencyMode: 'parallel',
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

  assert.equal(maxActive, 2);
});

test('LifeStory frame approval separates stills from final motion generation', async () => {
  const {
    createMediaTask,
    initializeMediaTaskTables,
  } = jiti('../src/lib/media-tasks.ts');
  const { runFinalAssetsPhase, runFrameGenerationPhase } = jiti('../src/lib/pipeline_media.ts');

  const db = createDb();
  db.prepare('UPDATE sessions SET mode = ?, status = ? WHERE id = ?')
    .run('life_story', 'GENERATING_IMAGES', 'session-1');
  initializeMediaTaskTables(db);

  const frame = createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_scene_frame',
    provider: 'runway',
  });
  const narration = createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_narration',
    provider: 'runway',
  });
  createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_video_shot',
    provider: 'runway',
    dependsOnTaskIds: [frame.id, narration.id],
  });

  const executed = [];
  await runFrameGenerationPhase('session-1', {
    database: db,
    executors: {
      generate_scene_frame: async () => {
        executed.push('frame');
        return 'frame-url';
      },
      generate_narration: async () => {
        executed.push('narration');
        return 'audio-url';
      },
      generate_video_shot: async () => {
        executed.push('video');
        return 'video-url';
      },
    },
  });

  assert.deepEqual(executed, ['frame']);
  assert.equal(db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1').status, 'AWAITING_APPROVAL');

  await runFinalAssetsPhase('session-1', {
    database: db,
    executors: {
      generate_narration: async () => {
        executed.push('narration');
        return 'audio-url';
      },
      generate_video_shot: async () => {
        executed.push('video');
        return 'video-url';
      },
    },
  });

  assert.deepEqual(executed, ['frame', 'narration', 'video']);
  assert.equal(db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1').status, 'PREVIEW_READY');
});

test('media task runner records failed task attempts without advancing dependents', async () => {
  const {
    createMediaTask,
    initializeMediaTaskTables,
  } = jiti('../src/lib/media-tasks.ts');
  const { runMediaTaskRunner } = jiti('../src/lib/pipeline_media.ts');

  const db = createDb();
  initializeMediaTaskTables(db);

  const frame = createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_scene_frame',
    provider: 'runway',
  });
  createMediaTask(db, {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    kind: 'generate_video_shot',
    provider: 'runway',
    dependsOnTaskIds: [frame.id],
  });

  await assert.rejects(
    runMediaTaskRunner('session-1', {
      database: db,
      executors: {
        generate_scene_frame: async () => {
          throw new Error('runway is unavailable');
        },
      },
    }),
    /runway is unavailable/,
  );

  const tasks = db.prepare('SELECT kind, status, attempts, last_error FROM media_tasks ORDER BY created_at ASC').all();
  assert.deepEqual(tasks.map((task) => [task.kind, task.status, task.attempts]), [
    ['generate_scene_frame', 'failed', 1],
    ['generate_video_shot', 'queued', 0],
  ]);
  assert.match(tasks[0].last_error, /runway is unavailable/);
  assert.equal(db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1').status, 'FAILED');
});
