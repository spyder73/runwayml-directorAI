import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('media generation logs fingerprint prompts without storing full prompt text', () => {
  const { buildMediaGenerationLog } = jiti('../src/lib/media-logging.ts');

  const log = buildMediaGenerationLog('scene_video_shot_generation_start', {
    sessionId: 'session-1',
    sceneId: 'scene-1',
    sceneIndex: 2,
    shotIndex: 1,
    shotCount: 2,
    mediaType: 'video',
    promptText: 'A very long generated video prompt with private story details and camera motion.',
    remoteUrl: 'https://example.runway/generated/private-output.mp4?token=secret',
    error: new Error('Runway timeout'),
  });

  assert.equal(log.event, 'media_generation');
  assert.equal(log.stage, 'scene_video_shot_generation_start');
  assert.equal(log.sessionId, 'session-1');
  assert.equal(log.promptHash.length, 12);
  assert.match(log.promptPreview, /generated video prompt/);
  assert.equal(log.promptText, undefined);
  assert.equal(log.remoteUrl, undefined);
  assert.equal(log.remoteHost, 'example.runway');
  assert.equal(log.errorMessage, 'Runway timeout');
});
