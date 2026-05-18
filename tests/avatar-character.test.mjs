import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  alias: {
    '@': path.join(process.cwd(), 'src'),
  },
});

test('avatar session tools stay within Runway limits and use max backend timeout', () => {
  const {
    avatarBackendTools,
    avatarClientTools,
    avatarSessionTools,
  } = jiti('../src/lib/avatar/tools.ts');

  assert.equal(avatarSessionTools.length <= 20, true);
  assert.equal(new Set(avatarSessionTools.map((tool) => tool.name)).size, avatarSessionTools.length);
  assert.equal(avatarClientTools.some((tool) => tool.name === 'set_avatar_layout'), true);
  assert.equal(avatarClientTools.some((tool) => tool.name === 'focus_email_prompt'), true);
  assert.equal(avatarBackendTools.some((tool) => tool.name === 'propose_film_treatment'), false);
  assert.equal(avatarBackendTools.some((tool) => tool.name === 'lock_scene_outline'), false);

  for (const tool of avatarBackendTools) {
    assert.equal(tool.type, 'backend_rpc');
    assert.equal(tool.timeoutSeconds, 8);
    assert.equal(tool.parameters.length <= 20, true);
  }
});

test('avatar realtime session readiness waits long enough for cold production starts', () => {
  const routeSource = fs.readFileSync(new URL('../src/app/api/avatar/session/route.ts', import.meta.url), 'utf8');

  assert.match(routeSource, /AVATAR_SESSION_READY_TIMEOUT_MS/);
  assert.match(routeSource, /60_000/);
  assert.match(routeSource, /Date\.now\(\) < deadline/);
  assert.doesNotMatch(routeSource, /attempt < 24/);
});

test('avatar readiness polling records production diagnostics without secrets', () => {
  const routeSource = fs.readFileSync(new URL('../src/app/api/avatar/session/route.ts', import.meta.url), 'utf8');

  assert.match(routeSource, /eventType: 'runway_status'/);
  assert.match(routeSource, /eventType: 'runway_ready_timeout'/);
  assert.match(routeSource, /avatarCallSessionId/);
  assert.match(routeSource, /runwaySessionId/);
  assert.match(routeSource, /elapsedMs/);
  assert.match(routeSource, /lastStatus/);
});

test('avatar session uses the saved Runway key instead of a separate character secret', () => {
  const routeSource = fs.readFileSync(new URL('../src/app/api/avatar/session/route.ts', import.meta.url), 'utf8');
  const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

  assert.doesNotMatch(routeSource, /RUNWAY_CHARACTER_API_SECRET/);
  assert.doesNotMatch(envExample, /RUNWAY_CHARACTER_API_SECRET/);
  assert.match(routeSource, /saved Runway API key/i);
});

test('avatar logging redacts secrets and records tool events', () => {
  const { initializeDatabaseSchema } = jiti('../src/lib/db.ts');
  const {
    recordAvatarCallEvent,
    redactAvatarLogValue,
  } = jiti('../src/lib/avatar/logging.ts');

  const database = new Database(':memory:');
  initializeDatabaseSchema(database);
  database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'hash');
  database.prepare(`
    INSERT INTO sessions (id, user_id, status, story_text, aspect_ratio, mode)
    VALUES (?, ?, 'INTERVIEW_ONBOARDING', '', '16:9', 'life_story')
  `).run('session-1', 'user-1');

  database.prepare(`
    INSERT INTO avatar_call_sessions (id, session_id, runway_session_id, status)
    VALUES (?, ?, ?, ?)
  `).run('call-1', 'session-1', 'runway-1', 'READY');

  const redacted = redactAvatarLogValue('Authorization: Bearer key_1234567890abcdef token=secret-token');
  assert.doesNotMatch(redacted, /key_1234567890abcdef/);
  assert.doesNotMatch(redacted, /secret-token/);

  recordAvatarCallEvent(database, {
    avatarCallSessionId: 'call-1',
    sessionId: 'session-1',
    runwaySessionId: 'runway-1',
    eventType: 'tool_result',
    toolName: 'update_profile_bucket',
    durationMs: 27,
    payload: { ok: true, apiKey: 'key_1234567890abcdef' },
  });

  const row = database.prepare('SELECT event_type, tool_name, duration_ms, payload_json FROM avatar_call_events').get();
  assert.equal(row.event_type, 'tool_result');
  assert.equal(row.tool_name, 'update_profile_bucket');
  assert.equal(row.duration_ms, 27);
  assert.doesNotMatch(row.payload_json, /key_1234567890abcdef/);
  database.close();
});

test('avatar profile tool updates the same story bucket tables as text interview tools', async () => {
  const { initializeDatabaseSchema } = jiti('../src/lib/db.ts');
  const { loadStoryBucket } = jiti('../src/lib/story-bucket.ts');
  const { createAvatarRpcTools } = jiti('../src/lib/avatar/tools.ts');

  const database = new Database(':memory:');
  initializeDatabaseSchema(database);
  database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'hash');
  database.prepare(`
    INSERT INTO sessions (id, user_id, status, story_text, aspect_ratio, mode, interview_medium)
    VALUES (?, ?, 'INTERVIEW_ONBOARDING', '', '16:9', 'life_story', 'voice')
  `).run('session-1', 'user-1');
  database.prepare(`
    INSERT INTO avatar_call_sessions (id, session_id, runway_session_id, status)
    VALUES (?, ?, ?, ?)
  `).run('call-1', 'session-1', 'runway-1', 'RUNNING');

  const tools = createAvatarRpcTools({
    database,
    appSessionId: 'session-1',
    avatarCallSessionId: 'call-1',
    runwaySessionId: 'runway-1',
  });

  const result = await tools.update_profile_bucket({
    payloadJson: JSON.stringify({
      profile: {
        protagonistName: 'Maya',
        age: '41',
        profession: 'architect',
        currentLocation: 'Berlin',
      },
    }),
  });

  const bucket = loadStoryBucket(database, 'session-1');
  const session = database.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1');
  assert.equal(result.ok, true);
  assert.equal(bucket.profile.protagonist_name, 'Maya');
  assert.equal(session.status, 'INTERVIEW_PSYCH_PROFILE');
  database.close();
});

test('avatar reference tool replies with a follow-up after labeling an upload', async () => {
  const { initializeDatabaseSchema } = jiti('../src/lib/db.ts');
  const { createAvatarRpcTools } = jiti('../src/lib/avatar/tools.ts');
  const { createReferenceAsset } = jiti('../src/lib/story-bucket.ts');

  const database = new Database(':memory:');
  initializeDatabaseSchema(database);
  database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'hash');
  database.prepare(`
    INSERT INTO sessions (id, user_id, status, story_text, aspect_ratio, mode, interview_medium)
    VALUES (?, ?, 'INTERVIEW_DYNAMIC', '', '16:9', 'life_story', 'voice')
  `).run('session-1', 'user-1');
  database.prepare(`
    INSERT INTO avatar_call_sessions (id, session_id, runway_session_id, status)
    VALUES (?, ?, ?, ?)
  `).run('call-1', 'session-1', 'runway-1', 'RUNNING');
  createReferenceAsset(database, 'session-1', {
    localUrl: '/api/media/uploaded-reference',
    targetType: 'reference',
    targetLabel: 'uploaded reference',
    usagePermissions: 'allowed',
    source: 'upload',
  });

  const tools = createAvatarRpcTools({
    database,
    appSessionId: 'session-1',
    avatarCallSessionId: 'call-1',
    runwaySessionId: 'runway-1',
  });

  const result = await tools.add_reference_subject({
    payloadJson: JSON.stringify({
      directorReply: 'I will remember Dorian as @dorian_2 for future scenes.',
      subjectType: 'person',
      displayName: 'Dorian',
      description: 'A thoughtful portrait in warm light.',
    }),
  });

  assert.equal(result.ok, true);
  assert.match(result.directorReply, /I will remember Dorian/);
  assert.match(result.directorReply, /\?/);
  database.close();
});

test('avatar reference request tool continues when protagonist photo is already handled', async () => {
  const { initializeDatabaseSchema } = jiti('../src/lib/db.ts');
  const { createAvatarRpcTools } = jiti('../src/lib/avatar/tools.ts');
  const { createReferenceAsset } = jiti('../src/lib/story-bucket.ts');

  const database = new Database(':memory:');
  initializeDatabaseSchema(database);
  database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'hash');
  database.prepare(`
    INSERT INTO sessions (id, user_id, status, story_text, aspect_ratio, mode, interview_medium, user_selfie_url)
    VALUES (?, ?, 'INTERVIEW_DYNAMIC', '', '16:9', 'life_story', 'voice', ?)
  `).run('session-1', 'user-1', '/api/media/selfie');
  database.prepare(`
    INSERT INTO avatar_call_sessions (id, session_id, runway_session_id, status)
    VALUES (?, ?, ?, ?)
  `).run('call-1', 'session-1', 'runway-1', 'RUNNING');
  createReferenceAsset(database, 'session-1', {
    localUrl: '/api/media/selfie',
    targetType: 'protagonist',
    targetLabel: 'Maya',
    usagePermissions: 'allowed',
    source: 'upload',
  });

  const tools = createAvatarRpcTools({
    database,
    appSessionId: 'session-1',
    avatarCallSessionId: 'call-1',
    runwaySessionId: 'runway-1',
  });

  const result = await tools.request_reference_upload({
    targetType: 'protagonist',
    targetLabel: 'Maya',
    promptText: 'Do you have a photo you would like to use?',
    reason: 'Keep the protagonist visually consistent.',
  });

  assert.equal(result.ok, true);
  assert.equal(result.requestId, null);
  assert.equal(result.alreadyHandled, true);
  assert.doesNotMatch(result.directorReply, /photo.*upload|upload.*photo/i);
  assert.notEqual(result.layout, 'upload');
  database.close();
});

test('avatar profile fallback asks the missing onboarding question after name and age', async () => {
  const { initializeDatabaseSchema } = jiti('../src/lib/db.ts');
  const { createAvatarRpcTools } = jiti('../src/lib/avatar/tools.ts');

  const database = new Database(':memory:');
  initializeDatabaseSchema(database);
  database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'hash');
  database.prepare(`
    INSERT INTO sessions (id, user_id, status, story_text, aspect_ratio, mode, interview_medium)
    VALUES (?, ?, 'INTERVIEW_ONBOARDING', '', '16:9', 'life_story', 'voice')
  `).run('session-1', 'user-1');
  database.prepare(`
    INSERT INTO avatar_call_sessions (id, session_id, runway_session_id, status)
    VALUES (?, ?, ?, ?)
  `).run('call-1', 'session-1', 'runway-1', 'RUNNING');

  const tools = createAvatarRpcTools({
    database,
    appSessionId: 'session-1',
    avatarCallSessionId: 'call-1',
    runwaySessionId: 'runway-1',
  });

  const result = await tools.update_profile_bucket({
    payloadJson: JSON.stringify({
      profile: {
        protagonistName: 'Maya',
        age: '41',
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.directorReply, /next piece of the story/i);
  assert.match(result.directorReply, /(where.*live|live.*where|profession|work|do now|current place)/i);
  database.close();
});

test('avatar scene outline handoff locks production and ends the call', async () => {
  const { initializeDatabaseSchema } = jiti('../src/lib/db.ts');
  const { createAvatarRpcTools } = jiti('../src/lib/avatar/tools.ts');

  const database = new Database(':memory:');
  initializeDatabaseSchema(database);
  database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'hash');
  database.prepare(`
    INSERT INTO sessions (id, user_id, status, story_text, aspect_ratio, mode, interview_medium)
    VALUES (?, ?, 'INTERVIEW_DYNAMIC', '', '16:9', 'life_story', 'voice')
  `).run('session-1', 'user-1');
  database.prepare(`
    INSERT INTO avatar_call_sessions (id, session_id, runway_session_id, status)
    VALUES (?, ?, ?, ?)
  `).run('call-1', 'session-1', 'runway-1', 'RUNNING');

  const productionStarts = [];
  const tools = createAvatarRpcTools({
    database,
    appSessionId: 'session-1',
    avatarCallSessionId: 'call-1',
    runwaySessionId: 'runway-1',
    productionRunner: async (sessionId, options) => {
      productionStarts.push({ sessionId, sameDatabase: options.database === database });
    },
  });

  const result = await tools.propose_scene_outline({
    payloadJson: JSON.stringify({
      directorReply: 'Here is the outline.',
      treatment: {
        title: 'A Small Film',
        emotionalThesis: 'A life shaped by curiosity and chosen friends.',
        narrativeArc: 'arrival, discovery, friendship, and creative purpose',
        visualMotif: 'warm screens, winter streets, and handwritten plans',
        narratorStyle: 'intimate first-person essay',
        endingFeeling: 'quiet momentum',
      },
      scenes: [
        {
          title: 'Opening the Door',
          summary: 'The protagonist arrives in a new city and starts looking for a shape to life.',
          narratorText: 'I arrived with questions, a laptop, and the feeling that the story had only just begun.',
          imagePrompt: 'Cinematic portrait of a young protagonist near a city window, warm practical light, intimate documentary tone.',
          videoPrompt: 'Slow dolly toward the window as city lights shimmer and the protagonist turns toward the room.',
          duration: 5,
          emotionalPurpose: 'Begin with anticipation and self-recognition.',
          protagonistVisible: false,
        },
      ],
    }),
  });

  const session = database.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1');
  const treatment = database.prepare('SELECT * FROM story_treatments WHERE session_id = ?').get('session-1');
  const scenes = database.prepare('SELECT * FROM scenes WHERE session_id = ?').all('session-1');
  const tasks = database.prepare('SELECT kind, status FROM media_tasks WHERE session_id = ? ORDER BY created_at ASC').all('session-1');

  assert.equal(result.ok, true);
  assert.equal(result.endCall, true);
  assert.equal(result.layout, 'email');
  assert.equal(result.directorReply, "All right, we'll wrap it up here. Add your email and I'll message you once your movie is ready!");
  assert.doesNotMatch(result.directorReply, /draft/i);
  assert.equal(session.status, 'GENERATING_IMAGES');
  assert.equal(treatment.status, 'approved');
  assert.equal(scenes.length, 1);
  assert.deepEqual(tasks.map((task) => task.kind), ['generate_scene_frame', 'generate_narration', 'generate_video_shot', 'render_final']);
  assert.deepEqual(productionStarts, [{ sessionId: 'session-1', sameDatabase: true }]);
  database.close();
});

test('avatar prompts and paste-ready docs preserve director behavior', () => {
  const {
    buildAvatarKnowledge,
    buildAvatarPersonality,
    buildAvatarStartScript,
  } = jiti('../src/lib/avatar/prompts.ts');

  const personality = buildAvatarPersonality({ storyContext: '' });
  const startScript = buildAvatarStartScript({ userName: 'Maya' });
  const knowledge = buildAvatarKnowledge();

  assert.match(personality, /Nico Hale/);
  assert.match(personality, /one question at a time/i);
  assert.match(personality, /use tools silently/i);
  assert.doesNotMatch(personality, /Move briskly/i);
  assert.match(personality, /at least three emotionally specific memories/i);
  assert.match(personality, /childhood, younger adult, and current-life/i);
  assert.match(personality, /selfie checkpoint is mandatory to ask/i);
  assert.match(personality, /request_reference_upload/);
  assert.match(personality, /protagonist selfie/i);
  assert.match(personality, /central friend/i);
  assert.match(personality, /show_upload_dropzone/);
  assert.match(startScript, /Maya/);
  assert.doesNotMatch(startScript, /I am Nico Hale/);
  assert.match(startScript, /what is your name/i);
  assert.match(knowledge, /LifeStory opening/);
  assert.match(knowledge, /Reference gathering/);
  assert.match(knowledge, /Prioritize photos of the protagonist/i);
  assert.match(knowledge, /one important friend/i);
  assert.match(knowledge, /Place images are low priority/i);
  assert.match(knowledge, /Do not call propose_scene_outline/i);
  assert.match(knowledge, /at least three emotionally specific memories/i);
  assert.match(knowledge, /protagonist selfie decision/i);
  assert.match(knowledge, /call propose_scene_outline once/i);
  assert.match(knowledge, /Do not call propose_film_treatment/i);
  assert.match(knowledge, /All right, we'll wrap it up here/i);
  assert.doesNotMatch(knowledge, /draft of my idea/i);
  assert.match(knowledge, /end the call/i);

  const docs = [];
  for (const fileName of ['personality.md', 'start-script.md', 'knowledge.md']) {
    const source = fs.readFileSync(new URL(`../docs/runway-character/${fileName}`, import.meta.url), 'utf8');
    docs.push(source);
    assert.match(source, /Nico Hale|LifeStory|Director/i);
    assert.doesNotMatch(source, /TBD|TODO/);
  }
  const combinedDocs = docs.join('\n');
  assert.match(combinedDocs, /request_reference_upload/);
  assert.match(combinedDocs, /central friend/i);
  assert.match(combinedDocs, /All right, we'll wrap it up here/i);
});

test('avatar upload tools tell the model to ask for protagonist and central friend images', () => {
  const {
    avatarBackendTools,
    avatarClientTools,
  } = jiti('../src/lib/avatar/tool-definitions.ts');

  const requestTool = avatarBackendTools.find((tool) => tool.name === 'request_reference_upload');
  const showDropzoneTool = avatarClientTools.find((tool) => tool.name === 'show_upload_dropzone');

  assert.ok(requestTool);
  assert.ok(showDropzoneTool);
  assert.match(requestTool.description, /protagonist/i);
  assert.match(requestTool.description, /central friend/i);
  assert.match(requestTool.description, /upload, describe, or skip/i);
  assert.match(showDropzoneTool.description, /immediately after request_reference_upload/i);
});
