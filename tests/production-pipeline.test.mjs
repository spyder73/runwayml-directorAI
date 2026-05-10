import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('shot planner fallback splits long narration into bounded shots', () => {
  const { normalizeShotPlan } = jiti('../src/lib/shot_planner.ts');

  const shots = normalizeShotPlan('Wide shot of a railway platform at dusk.', 23.2);

  assert.ok(shots.length > 1);
  assert.equal(Math.ceil(shots.reduce((total, shot) => total + shot.duration, 0)), 24);
  for (const shot of shots) {
    assert.ok(shot.duration >= 2);
    assert.ok(shot.duration <= 10);
    assert.match(shot.prompt, /railway platform/);
  }
});

test('production references choose consented tagged assets and append prompt tags', () => {
  const { prepareSceneReferences } = jiti('../src/lib/production-references.ts');

  const references = prepareSceneReferences({
    promptText: 'Maya waits outside the school doors.',
    sceneReferenceAssetIds: ['self-id', 'school-id', 'denied-id'],
    protagonistVisible: true,
    assets: [
      { id: 'school-id', local_url: '/uploads/school.jpg', runway_uri: null, stable_tag: 'school_01', usage_permissions: 'allowed', target_type: 'place', vision_description: null },
      { id: 'denied-id', local_url: '/uploads/denied.jpg', runway_uri: null, stable_tag: 'denied_01', usage_permissions: 'denied', target_type: 'person', vision_description: null },
      { id: 'self-id', local_url: '/uploads/maya.jpg', runway_uri: null, stable_tag: 'self', usage_permissions: 'allowed', target_type: 'protagonist', vision_description: null },
    ],
  });

  assert.deepEqual(references.selectedAssets.map((asset) => asset.id), ['self-id', 'school-id']);
  assert.equal(references.referenceImages.length, 2);
  assert.match(references.promptText, /@self/);
  assert.match(references.promptText, /@school_01/);
  assert.doesNotMatch(references.promptText, /@denied_01/);
});

test('final render plan produces a real ffmpeg output path and command inputs', () => {
  const { buildFinalRenderPlan } = jiti('../src/lib/final-render.ts');

  const plan = buildFinalRenderPlan({
    sessionId: 'session-1',
    aspectRatio: '9:16',
    scenes: [
      {
        id: 'scene-1',
        scene_index: 0,
        narrator_text: 'First line.',
        video_url: JSON.stringify(['/generated/video/session-1/shot-1.mp4', '/generated/video/session-1/shot-2.mp4']),
        audio_url: '/generated/audio/session-1/scene-1.mp3',
        duration: 8,
      },
    ],
  });

  assert.equal(plan.publicUrl.startsWith('/generated/final/session-1/'), true);
  assert.equal(plan.outputFilePath.endsWith('.mp4'), true);
  assert.deepEqual(plan.videoInputs.map((input) => input.publicUrl), [
    '/generated/video/session-1/shot-1.mp4',
    '/generated/video/session-1/shot-2.mp4',
  ]);
  assert.deepEqual(plan.audioInputs.map((input) => input.publicUrl), ['/generated/audio/session-1/scene-1.mp3']);
  assert.match(plan.filterGraph, /crop=720:1280/);
});

test('Runway image task helper preserves the SDK resource client binding', async () => {
  const { createTextToImageTask } = jiti('../src/lib/runway.ts');
  const resource = {
    _client: { ok: true },
    create(body, options) {
      assert.equal(this._client.ok, true);
      assert.equal(body.model, 'gpt_image_2');
      assert.equal(options.timeout, 60000);
      return Promise.resolve({ id: 'task-1' });
    },
  };

  const task = await createTextToImageTask(resource, {
    promptText: 'A warm kitchen memory.',
    quality: 'low',
    ratio: '1920:1088',
    sessionId: 'session-1',
  });

  assert.equal(task.id, 'task-1');
});
