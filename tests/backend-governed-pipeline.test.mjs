import assert from 'node:assert/strict';
import fs from 'node:fs';
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
    .run('session-1', 'INTERVIEW_DYNAMIC', '', '16:9', 'life_story');

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

test('prompt linting allows image prompts to describe exclusions explicitly', () => {
  const { lintRunwayImagePrompt } = jiti('../src/lib/prompt-lint.ts');

  const result = lintRunwayImagePrompt({
    promptText: '@opening_frame rainy train platform after the train has passed; do not reset the train to its opening position.',
    referenceImages: [
      { tag: 'opening_frame', uri: 'data:image/jpeg;base64,abc' },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
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

test('video prompt repair uses validation errors to remove reference tags before retry', async () => {
  const { repairRunwayVideoPromptForValidation } = jiti('../src/lib/video-prompt-repair.ts');

  const repaired = await repairRunwayVideoPromptForValidation({
    promptText: 'Dorian and Martin laugh together at a festival. Use @protagonist_dori and @martin as references.',
    durationSeconds: 6,
    validationError: 'Video prompt failed validation: Video motion prompts should not contain @tag references.',
    openrouterApiKey: 'test-key',
    generateRepairText: async ({ validationError }) => {
      assert.match(validationError, /@tag references/);
      return 'The camera drifts through the festival crowd as Dorian and Martin laugh together, holding on their easy friendship and warm movement.';
    },
  });

  assert.equal(repaired.repaired, true);
  assert.doesNotMatch(repaired.promptText, /@protagonist_dori|@martin/);
  assert.match(repaired.promptText, /camera|drifts|laugh/i);
});

test('continuity reference prompts keep only the opening frame tag', () => {
  const { buildContinuityReferencePrompt } = jiti('../src/lib/pipeline_media.ts');

  const prompt = buildContinuityReferencePrompt({
    duration: 2,
    prompt: 'Close up on Dorian and Martin laughing together.',
    referencePrompt: 'A close up on the faces of @protagonist_dori and @martin as they laugh together.',
  }, 1);

  assert.match(prompt, /@opening_frame/);
  assert.doesNotMatch(prompt, /@protagonist_dori|@martin/);
});

test('prompt moderation caps output tokens before OpenRouter receives the request', () => {
  const source = fs.readFileSync(new URL('../src/lib/moderation.ts', import.meta.url), 'utf8');

  assert.match(source, /MAX_PROMPT_MODERATION_OUTPUT_TOKENS/);
  assert.match(source, /maxOutputTokens:\s*MAX_PROMPT_MODERATION_OUTPUT_TOKENS/);
});

test('bounded OpenRouter helper calls declare explicit output token caps', () => {
  const pipelineSource = fs.readFileSync(new URL('../src/lib/pipeline.ts', import.meta.url), 'utf8');
  const directorRouteSource = fs.readFileSync(new URL('../src/app/api/pipeline/director/route.ts', import.meta.url), 'utf8');
  const uploadRouteSource = fs.readFileSync(new URL('../src/app/api/pipeline/upload/route.ts', import.meta.url), 'utf8');
  const shotPlannerSource = fs.readFileSync(new URL('../src/lib/shot_planner.ts', import.meta.url), 'utf8');
  const videoPromptRepairSource = fs.readFileSync(new URL('../src/lib/video-prompt-repair.ts', import.meta.url), 'utf8');

  assert.match(pipelineSource, /MAX_DIRECTOR_OUTLINE_OUTPUT_TOKENS/);
  assert.match(pipelineSource, /MAX_DIRECTOR_CONTINUATION_OUTPUT_TOKENS/);
  assert.match(pipelineSource, /MAX_DIRECTOR_TOOL_OUTPUT_TOKENS/);
  assert.match(directorRouteSource, /MAX_DIRECTOR_REVISION_OUTPUT_TOKENS/);
  assert.match(uploadRouteSource, /MAX_VISION_DESCRIPTION_OUTPUT_TOKENS/);
  assert.match(shotPlannerSource, /MAX_SHOT_PLAN_OUTPUT_TOKENS/);
  assert.match(shotPlannerSource, /MAX_SHOT_PLAN_REPAIR_OUTPUT_TOKENS/);
  assert.match(videoPromptRepairSource, /MAX_VIDEO_PROMPT_REPAIR_OUTPUT_TOKENS/);
});

test('LifeStory prompts cover childhood briefly and emphasize young adult and adult chapters', () => {
  const profilePrompt = fs.readFileSync(new URL('../src/lib/ai/prompts/life-story-profile.ts', import.meta.url), 'utf8');
  const deepPrompt = fs.readFileSync(new URL('../src/lib/ai/prompts/life-story-deep-interview.ts', import.meta.url), 'utf8');
  const outlinePrompt = fs.readFileSync(new URL('../src/lib/ai/prompts/scene-outline.ts', import.meta.url), 'utf8');

  assert.match(profilePrompt, /childhood/i);
  assert.match(profilePrompt, /young adult/i);
  assert.match(profilePrompt, /adulthood/i);
  assert.match(deepPrompt, /do not omit childhood/i);
  assert.match(deepPrompt, /do not dwell/i);
  assert.match(outlinePrompt, /younger adult/i);
});

test('scene outline prompt tells the director exact narration word budgets', () => {
  const outlinePrompt = fs.readFileSync(new URL('../src/lib/ai/prompts/scene-outline.ts', import.meta.url), 'utf8');

  assert.match(outlinePrompt, /narratorText/i);
  assert.match(outlinePrompt, /word budget/i);
  assert.match(outlinePrompt, /duration \* 2\.2/i);
  assert.match(outlinePrompt, /5-second scene.*11 words/i);
  assert.match(outlinePrompt, /10-second scene.*22 words/i);
  assert.match(outlinePrompt, /entire film/i);
});

test('cost estimator uses gpt_image_2 low sketches and high final frames', () => {
  const { estimateProductionCost } = jiti('../src/lib/cost-estimator.ts');

  const estimate = estimateProductionCost({
    mode: 'life_story',
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
    mode: 'life_story',
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

test('explicit treatment approval can move a LifeStory into scene outline despite remaining readiness gaps', () => {
  const { initializeStoryBucketTables, loadStoryBucket, proposeFilmTreatment } = jiti('../src/lib/story-bucket.ts');
  const { isTreatmentApprovalForOutline, isMovieCreationRequest } = jiti('../src/lib/pipeline.ts');

  const db = createDb();
  initializeStoryBucketTables(db);
  db.prepare('UPDATE sessions SET mode = ? WHERE id = ?').run('life_story', 'session-1');
  proposeFilmTreatment(db, 'session-1', {
    title: 'Currents and Beats',
    emotionalThesis: 'Transformation through extremes.',
    narrativeArc: 'Aachen focus to Albania danger to Berlin energy.',
    visualMotif: 'Water becoming light.',
    narratorStyle: 'Introspective and rhythmic.',
    endingFeeling: 'Open momentum.',
  });

  const bucket = loadStoryBucket(db, 'session-1');

  assert.equal(isTreatmentApprovalForOutline('just implement this draft i like it', bucket), true);
  assert.equal(isTreatmentApprovalForOutline('sure but I would add Aachen', bucket), false);
  assert.equal(isMovieCreationRequest('no thats it, lets create the movie'), true);
  assert.equal(isMovieCreationRequest('nothing else, create the movie'), true);
  assert.equal(isMovieCreationRequest('what else should we explore?'), false);
});

test('fallback treatment outline creates scene rows from the approved story bucket', () => {
  const {
    applyProfileBucketUpdate,
    initializeStoryBucketTables,
    loadStoryBucket,
    proposeFilmTreatment,
  } = jiti('../src/lib/story-bucket.ts');
  const { buildFallbackSceneOutlineFromBucket } = jiti('../src/lib/pipeline.ts');

  const db = createDb();
  initializeStoryBucketTables(db);
  proposeFilmTreatment(db, 'session-1', {
    title: 'Currents and Beats',
    emotionalThesis: 'Transformation through extremes.',
    narrativeArc: 'Aachen focus to Albania danger to Berlin energy.',
    visualMotif: 'Water becoming light.',
    narratorStyle: 'Introspective and rhythmic.',
    endingFeeling: 'Open momentum.',
  });
  applyProfileBucketUpdate(db, 'session-1', {
    memoryCandidates: [
      {
        title: 'The Drin River',
        description: 'Kayaking down the Drin river with Dorian and nearly losing control.',
        emotionalPurpose: 'Adventure and danger.',
        visualSummary: 'A kayak cutting through wild river water in Albania.',
      },
    ],
  });

  const outline = buildFallbackSceneOutlineFromBucket(loadStoryBucket(db, 'session-1'));

  assert.ok(outline.scenes.length >= 1);
  assert.match(outline.scenes[0].title, /Drin River|Currents and Beats/);
  assert.match(outline.scenes[0].videoPrompt, /camera/i);
  assert.ok(outline.scenes[0].duration >= 2);
  assert.ok(outline.scenes[0].duration <= 10);
});

test('approved treatment outline draft prompt carries scene diversity guidance', () => {
  const {
    applyProfileBucketUpdate,
    initializeStoryBucketTables,
    loadStoryBucket,
    proposeFilmTreatment,
  } = jiti('../src/lib/story-bucket.ts');
  const { buildTreatmentApprovedOutlineDraftPrompt } = jiti('../src/lib/pipeline.ts');

  const db = createDb();
  initializeStoryBucketTables(db);
  proposeFilmTreatment(db, 'session-1', {
    title: 'The Place Became Familiar',
    emotionalThesis: 'Belonging arrived through a sequence of ordinary places.',
    narrativeArc: 'nervous arrival to shared routine to quiet belonging',
    visualMotif: 'thresholds, tables, and late afternoon light',
    narratorStyle: 'warm and direct',
    endingFeeling: 'belonging',
  });
  applyProfileBucketUpdate(db, 'session-1', {
    memoryCandidates: [
      {
        title: 'Finding a rhythm',
        description: 'Maya moved through a demanding class, a friendship routine, and the walk home that made the city feel less strange.',
        emotionalPurpose: 'A new place became approachable through small repeated moments.',
        visualSummary: 'A class space, a shared table, and an evening walk.',
      },
    ],
  });

  const prompt = buildTreatmentApprovedOutlineDraftPrompt(loadStoryBucket(db, 'session-1'));

  assert.match(prompt, /life chapter/i);
  assert.match(prompt, /distinct locations or action beats/i);
  assert.match(prompt, /one scenery/i);
  assert.match(prompt, /repeated.*same background/i);
  assert.doesNotMatch(prompt, /Heidelberg|Kareem|German course|classroom|cafe/i);
});

test('new supporting people can trigger an optional reference upload checkpoint', () => {
  const {
    applyProfileBucketUpdate,
    initializeStoryBucketTables,
    maybeCreateSupportingReferenceUploadRequest,
  } = jiti('../src/lib/story-bucket.ts');

  const db = createDb();
  initializeStoryBucketTables(db);
  applyProfileBucketUpdate(db, 'session-1', {
    entities: [
      {
        type: 'friend',
        displayName: 'Dorian',
        relationship: 'kayaking friend',
        description: 'He was with Moritz on the Drin river trip.',
      },
    ],
  });

  const request = maybeCreateSupportingReferenceUploadRequest(db, 'session-1', [
    { type: 'friend', displayName: 'Dorian', relationship: 'kayaking friend' },
  ]);
  const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1');

  assert.equal(request?.target_label, 'Dorian');
  assert.equal(request?.target_type, 'friend');
  assert.match(request?.prompt_text || '', /Dorian/);
  assert.match(request?.prompt_text || '', /skip/i);
  assert.equal(session.status, 'AWAITING_REFERENCE');
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

test('user-triggered media task resets can revive exhausted render attempts', () => {
  const {
    createMediaTask,
    failMediaTask,
    initializeMediaTaskTables,
    requeueMediaTasks,
    resetFailedMediaTasks,
    selectRunnableMediaTasks,
  } = jiti('../src/lib/media-tasks.ts');

  const db = createDb();
  initializeMediaTaskTables(db);
  const render = createMediaTask(db, {
    sessionId: 'session-1',
    kind: 'render_final',
    provider: 'local',
    maxAttempts: 1,
  });

  failMediaTask(db, render.id, 'h264 crf rejected');
  resetFailedMediaTasks(db, { sessionId: 'session-1', kind: 'render_final' });
  assert.deepEqual(selectRunnableMediaTasks(db, 'session-1').map((task) => task.id), [render.id]);

  db.prepare('UPDATE media_tasks SET status = ?, attempts = ?, max_attempts = ? WHERE id = ?')
    .run('queued', 3, 3, render.id);
  requeueMediaTasks(db, { sessionId: 'session-1', kind: 'render_final', clearOutput: true });
  assert.deepEqual(selectRunnableMediaTasks(db, 'session-1').map((task) => task.id), [render.id]);
});

test('render route requeues the final render task before starting the runner', () => {
  const routeSource = fs.readFileSync(new URL('../src/app/api/pipeline/render/route.ts', import.meta.url), 'utf8');

  assert.match(routeSource, /requeueMediaTasks/);
  assert.match(routeSource, /kind: 'render_final'/);
  assert.match(routeSource, /clearOutput: true/);
});

test('media task tables persist reconnectable render progress', () => {
  const {
    createMediaTask,
    getRenderProgressForSession,
    initializeMediaTaskTables,
    updateMediaTaskProgress,
  } = jiti('../src/lib/media-tasks.ts');

  const db = createDb();
  initializeMediaTaskTables(db);

  const columns = db.prepare('PRAGMA table_info(media_tasks)').all().map((column) => column.name);
  assert.ok(columns.includes('progress'));
  assert.ok(columns.includes('progress_message'));
  assert.ok(columns.includes('progress_detail_json'));
  assert.ok(columns.includes('progress_updated_at'));

  const task = createMediaTask(db, {
    sessionId: 'session-1',
    kind: 'render_final',
    provider: 'local',
  });

  updateMediaTaskProgress(db, task.id, {
    progress: 0.42,
    message: 'Rendering frames',
    detail: {
      renderedFrames: 42,
      encodedFrames: 12,
      totalFrames: 100,
      stitchStage: 'encoding',
    },
  });

  const progress = getRenderProgressForSession(db, 'session-1');
  assert.equal(progress.progress, 0.42);
  assert.equal(progress.message, 'Rendering frames');
  assert.equal(progress.renderedFrames, 42);
  assert.equal(progress.encodedFrames, 12);
  assert.equal(progress.totalFrames, 100);
  assert.equal(progress.stitchStage, 'encoding');
  assert.equal(typeof progress.updatedAt, 'string');
});

test('render progress is included in backend SSE payload sources', () => {
  const typeSource = fs.readFileSync(new URL('../src/lib/types.ts', import.meta.url), 'utf8');
  const routeSource = fs.readFileSync(new URL('../src/app/api/pipeline/events/route.ts', import.meta.url), 'utf8');
  const pipelineSource = fs.readFileSync(new URL('../src/lib/pipeline_media.ts', import.meta.url), 'utf8');
  const renderJobSource = fs.readFileSync(new URL('../src/lib/render-job.ts', import.meta.url), 'utf8');

  assert.match(typeSource, /export type RenderProgressPayload/);
  assert.match(typeSource, /render_progress\?: RenderProgressPayload \| null/);
  assert.match(routeSource, /render_progress: getRenderProgressForSession/);
  assert.match(pipelineSource, /render_progress: getRenderProgressForSession/);
  assert.match(pipelineSource, /updateRenderProgressForSession/);
  assert.match(renderJobSource, /updateRenderProgressForSession/);
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

test('automatic production pipeline runs frames, final assets, and render', async () => {
  const {
    createMediaTask,
    initializeMediaTaskTables,
  } = jiti('../src/lib/media-tasks.ts');
  const { runAutomaticProductionPipeline } = jiti('../src/lib/pipeline_media.ts');

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
  await runAutomaticProductionPipeline('session-1', {
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
      render_final: async () => {
        executed.push('render');
        return 'final-url';
      },
    },
  });

  const tasks = db.prepare('SELECT kind, status, output_asset_id FROM media_tasks ORDER BY created_at ASC').all();
  const session = db.prepare('SELECT status, final_video_url FROM sessions WHERE id = ?').get('session-1');
  assert.deepEqual(new Set(executed), new Set(['frame', 'narration', 'video', 'render']));
  assert.deepEqual(tasks.map((task) => [task.kind, task.status, task.output_asset_id]), [
    ['generate_scene_frame', 'succeeded', 'frame-url'],
    ['generate_narration', 'succeeded', 'audio-url'],
    ['generate_video_shot', 'succeeded', 'video-url'],
    ['render_final', 'succeeded', 'final-url'],
  ]);
  assert.equal(session.status, 'COMPLETED');
  assert.equal(session.final_video_url, 'final-url');
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

test('shot plan progress keeps completed sub-shots and only reports complete when every shot has a url', () => {
  const {
    mergeShotPlanProgress,
    shotPlanVideoUrls,
  } = jiti('../src/lib/pipeline_media.ts');

  const plannedShots = [
    { duration: 4, prompt: 'Wide shot as Maya walks through twilight city lights.', referencePrompt: 'Maya walking through twilight city lights.' },
    { duration: 4, prompt: 'Close-up as Maya pauses by a shop window.', referencePrompt: 'Maya paused by a shop window.' },
  ];
  const existing = JSON.stringify([
    {
      duration: 4,
      prompt: 'Wide shot as Maya walks through twilight city lights.',
      reference_prompt: 'Maya walking through twilight city lights.',
      reference_image_url: '/generated/image/session-1/shot-1.jpg',
      url: '/generated/video/session-1/shot-1.mp4',
      status: 'succeeded',
    },
    {
      duration: 4,
      prompt: 'Close-up as Maya pauses by a shop window.',
      reference_prompt: 'Maya paused by a shop window.',
      reference_image_url: '/generated/image/session-1/shot-2.jpg',
      status: 'failed',
      last_error: 'prompt failed validation',
    },
  ]);

  const progress = mergeShotPlanProgress(existing, plannedShots);

  assert.equal(progress[0].url, '/generated/video/session-1/shot-1.mp4');
  assert.equal(progress[0].status, 'succeeded');
  assert.equal(progress[1].url, undefined);
  assert.equal(progress[1].status, 'pending');
  assert.deepEqual(shotPlanVideoUrls(progress), []);

  assert.equal(progress[1].visual_start_state, undefined);

  progress[1].url = '/generated/video/session-1/shot-2.mp4';
  progress[1].status = 'succeeded';
  assert.deepEqual(shotPlanVideoUrls(progress), [
    '/generated/video/session-1/shot-1.mp4',
    '/generated/video/session-1/shot-2.mp4',
  ]);
});

test('shot plan progress persists storyboard metadata for sub-shot retries', () => {
  const { mergeShotPlanProgress } = jiti('../src/lib/pipeline_media.ts');

  const progress = mergeShotPlanProgress(null, [
    {
      duration: 4,
      prompt: 'Tracking shot from behind as Maya walks down a sidewalk at twilight.',
      referencePrompt: 'Maya walking down a sidewalk at twilight.',
      visualStartState: 'Maya begins walking down the sidewalk at twilight.',
      visualEndState: 'Maya reaches the lit shop window and slows to a stop.',
      cameraRole: 'rear tracking wide shot',
    },
    {
      duration: 4,
      prompt: 'Close-up from outside the shop window as Maya studies her reflection in the glass.',
      referencePrompt: 'Using @opening_frame as the visual reference, Maya stands beside the lit shop window at twilight.',
      visualStartState: 'Maya stands beside the lit shop window at twilight.',
      visualEndState: 'Maya smiles faintly at her reflection.',
      cameraRole: 'exterior reflection close-up',
      angleChangeReason: 'The camera changes from a rear tracking view to an exterior close-up through the reflective window glass.',
    },
  ]);

  assert.equal(progress[0].visual_start_state, 'Maya begins walking down the sidewalk at twilight.');
  assert.equal(progress[0].visual_end_state, 'Maya reaches the lit shop window and slows to a stop.');
  assert.equal(progress[1].camera_role, 'exterior reflection close-up');
  assert.match(progress[1].angle_change_reason, /rear tracking view/);
});

test('shot prompt updates clear only the selected sub-shot media', () => {
  const { updateShotPlanPromptJson } = jiti('../src/lib/pipeline_media.ts');

  const updated = JSON.parse(updateShotPlanPromptJson(JSON.stringify([
    {
      duration: 4,
      prompt: 'Wide shot as Maya walks through twilight city lights.',
      reference_prompt: 'Maya walking through twilight city lights.',
      reference_image_url: '/generated/image/session-1/shot-1.jpg',
      url: '/generated/video/session-1/shot-1.mp4',
      status: 'succeeded',
    },
    {
      duration: 4,
      prompt: 'Close-up as Maya pauses by a shop window.',
      reference_prompt: 'Maya paused by a shop window.',
      reference_image_url: '/generated/image/session-1/shot-2.jpg',
      url: '/generated/video/session-1/shot-2.mp4',
      status: 'failed',
      last_error: 'prompt failed validation',
    },
  ]), 1, {
    prompt: 'Close-up as Maya smiles softly at her reflection while city lights shimmer in the glass.',
    referencePrompt: 'Maya smiling softly at her reflection in a shop window, city lights shimmering in the glass.',
  }));

  assert.equal(updated[0].url, '/generated/video/session-1/shot-1.mp4');
  assert.equal(updated[0].status, 'succeeded');
  assert.equal(updated[1].url, undefined);
  assert.equal(updated[1].reference_image_url, undefined);
  assert.equal(updated[1].last_error, undefined);
  assert.equal(updated[1].status, 'pending');
  assert.match(updated[1].prompt, /smiles softly/);
  assert.match(updated[1].reference_prompt, /shop window/);
});
