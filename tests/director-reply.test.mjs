import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('tool-only reference replies keep the conversation moving', () => {
  const { ensureProactiveDirectorReply } = jiti('../src/lib/director-continuation.ts');

  const reply = ensureProactiveDirectorReply(
    'I will remember Dorian as @dorian_2 for future scenes.',
    { fallbackQuestion: 'What should we explore next?' },
  );

  assert.match(reply, /I will remember Dorian/);
  assert.match(reply, /What should we explore next\?/);
  assert.equal(
    ensureProactiveDirectorReply('Saved. What happened after that?', { fallbackQuestion: 'What next?' }),
    'Saved. What happened after that?',
  );
});

test('film treatment review uses a concise chat handoff', () => {
  const { filmTreatmentReviewHandoff } = jiti('../src/lib/treatment-reply.ts');
  const verboseTreatmentReply = [
    "Lenos, thank you for being so open. I've drafted a film treatment based on our conversation.",
    'Here is the plan:',
    '**Title:** Between the Lab and the Language',
    '**Narrative Arc:** We start with the disciplined past and end with the lab.',
  ].join('\n');

  const reply = filmTreatmentReviewHandoff(verboseTreatmentReply);

  assert.equal(reply, 'I shaped this into a film treatment. Take a look below and tell me whether it feels right.');
  assert.doesNotMatch(reply, /Here is the plan|Narrative Arc|Between the Lab/i);
});

test('pipeline routes treatment tool calls through the concise handoff', () => {
  const source = fs.readFileSync(new URL('../src/lib/pipeline.ts', import.meta.url), 'utf8');

  assert.match(source, /filmTreatmentReviewHandoff\(\)/);
  assert.doesNotMatch(source, /propose_film_treatment'[\s\S]{0,180}finalReply = text \|\| args\.directorReply/);
});
