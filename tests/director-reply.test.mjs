import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('profile bucket tool can carry the model authored director reply', () => {
  const { updateProfileBucketSchema } = jiti('../src/lib/ai/tools.ts');

  const parsed = updateProfileBucketSchema.parse({
    directorReply: 'That garden sounds like the first image of the film. What did it smell like after rain?',
    profile: { protagonistName: 'Johnny Depp', age: '62' },
  });

  assert.match(parsed.directorReply, /garden/);
});

test('director continuation prompt asks for a fresh visible response', () => {
  const { buildDirectorContinuationPrompt } = jiti('../src/lib/director-continuation.ts');

  const prompt = buildDirectorContinuationPrompt({
    status: 'INTERVIEW_PSYCH_PROFILE',
    storyContext: 'Profile: name: Johnny Depp; age: 62',
  });

  assert.match(prompt, /visible response/i);
  assert.match(prompt, /fresh/i);
});
