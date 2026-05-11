import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  shouldIgnoreStaleProductionUpdate,
} = jiti('../src/lib/session-update-guards.ts');

function session(status) {
  return {
    id: 'session-1',
    mode: 'life_story',
    interview_medium: 'text',
    status,
    story_text: '',
    aspect_ratio: '16:9',
    clarify_question: null,
    user_name: null,
    user_age: null,
    user_selfie_url: null,
    final_video_url: null,
    user_id: 'user-1',
    final_video_media_asset_id: null,
    render_notification_email: null,
    render_notification_sent_at: null,
    created_at: '2026-05-11 10:00:00',
    updated_at: '2026-05-11 10:00:01',
  };
}

test('production handoff ignores stale outline review snapshots', () => {
  assert.equal(shouldIgnoreStaleProductionUpdate({
    currentSession: session('GENERATING_IMAGES'),
    currentScenes: [],
    incomingSession: session('OUTLINE_REVIEW'),
    incomingScenes: [],
  }), true);
});

test('production handoff still accepts fresh production and failure updates', () => {
  assert.equal(shouldIgnoreStaleProductionUpdate({
    currentSession: session('GENERATING_IMAGES'),
    currentScenes: [],
    incomingSession: session('AWAITING_APPROVAL'),
    incomingScenes: [{ id: 'scene-1' }],
  }), false);

  assert.equal(shouldIgnoreStaleProductionUpdate({
    currentSession: session('GENERATING_IMAGES'),
    currentScenes: [],
    incomingSession: session('FAILED'),
    incomingScenes: [{ id: 'scene-1' }],
  }), false);
});
