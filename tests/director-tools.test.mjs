import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('director exposes story bucket and outline tools', () => {
  const { aiTools } = jiti('../src/lib/ai/tools.ts');
  const toolNames = Object.keys(aiTools);

  assert.deepEqual(toolNames, [
    'update_profile_bucket',
    'request_reference_upload',
    'save_reference_description',
    'generate_memory_sketch',
    'save_sketch_feedback',
    'propose_scene_outline',
    'revise_scene_outline',
    'lock_scene_outline',
  ]);
});

test('interview prompt builder includes private story context without implementation language', () => {
  const { buildInterviewSystemPrompt } = jiti('../src/lib/ai/prompts/index.ts');
  const prompt = buildInterviewSystemPrompt({
    mode: 'life_story',
    status: 'INTERVIEW_ONBOARDING',
    storyContext: 'Profile: Maya, 41',
    uploadContext: '',
    activeReferenceRequest: null,
  });

  assert.match(prompt, /Ask one question at a time/);
  assert.match(prompt, /Profile: Maya, 41/);
  assert.doesNotMatch(prompt, /tool call|JSON|schema|API/i);
});
