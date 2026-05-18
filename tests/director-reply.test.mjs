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
    latestUserMessage: 'I watched Interstellar in the cinema and it changed everything.',
    recentMessages: [
      { role: 'assistant', content: 'What is one concrete image, place, or feeling from that part of your life that should appear on screen?' },
      { role: 'user', content: 'The black hole and the 5D space opening up.' },
    ],
    recentQuestions: [
      'What is one concrete image, place, or feeling from that part of your life that should appear on screen?',
    ],
    activeReferenceRequestSummary: 'No active optional image request.',
  });

  assert.match(prompt, /visible response/i);
  assert.match(prompt, /fresh/i);
  assert.match(prompt, /anchor/i);
  assert.match(prompt, /Do not ask vague handoff questions/i);
  assert.match(prompt, /Recent conversation/i);
  assert.match(prompt, /Questions not to repeat/i);
  assert.match(prompt, /Interstellar/i);
  assert.match(prompt, /No active optional image request/i);
});

test('director continuation validation blocks repeated, crowded, and resolved-selfie replies', () => {
  const {
    extractAssistantQuestions,
    validateDirectorContinuation,
  } = jiti('../src/lib/director-continuation.ts');

  const recentMessages = [
    { role: 'assistant', content: 'What is one concrete image, place, or feeling from that part of your life that should appear on screen?' },
    { role: 'user', content: 'Me watching the movie, then a transition into the black hole.' },
    { role: 'assistant', content: 'In "First exposure to Interstellar", what is one image, sound, or feeling that still comes back clearly?' },
  ];
  const recentQuestions = extractAssistantQuestions(recentMessages);

  assert.equal(
    validateDirectorContinuation({
      reply: 'What concrete image or feeling from that part of your life should appear on screen?',
      recentQuestions,
    }).valid,
    false,
  );

  assert.equal(
    validateDirectorContinuation({
      reply: 'What did it feel like? Who was there with you?',
      recentQuestions,
    }).valid,
    false,
  );

  assert.equal(
    validateDirectorContinuation({
      reply: 'If you are comfortable with it, could you add a selfie so I can keep you visually consistent?',
      recentQuestions,
      protagonistReferenceHandled: true,
    }).valid,
    false,
  );

  assert.equal(
    validateDirectorContinuation({
      reply: 'That image of the cinema opening into impossible space is strong. What did that moment change about the way you imagined your future?',
      recentQuestions,
      protagonistReferenceHandled: true,
    }).valid,
    true,
  );
});

test('contextual interview fallback uses known story details instead of a generic handoff', () => {
  const { buildContextualInterviewFollowUp } = jiti('../src/lib/director-continuation.ts');

  const question = buildContextualInterviewFollowUp({
    profile: {
      protagonist_name: 'Martin',
      age: '46',
      profession: 'law student',
      current_location: 'Cologne',
      summary: 'Martin studies law later in life, loves Stromberg, and reads books.',
    },
    timelineEvents: [],
    memoryCandidates: [],
    entities: [],
    referenceAssets: [],
    sceneOutline: [],
    sceneOutlineComments: [],
    uploadRequests: [],
    treatment: null,
  });

  assert.doesNotMatch(question, /what should we explore next/i);
  assert.match(question, /(law|Stromberg|books|Cologne)/i);
  assert.match(question, /\?$/);
});

test('contextual interview fallback moves forward after user says they already answered', () => {
  const { buildContextualInterviewFollowUp } = jiti('../src/lib/director-continuation.ts');

  const question = buildContextualInterviewFollowUp({
    profile: {
      protagonist_name: 'Dorian',
      age: '23',
      profession: 'Student of quantum technology',
      current_location: 'Krakow',
      summary: null,
    },
    timelineEvents: [{ label: 'Interstellar', description: 'Watching Interstellar inspired physics.', emotion: 'awe' }],
    memoryCandidates: [{ title: 'Interstellar', description: 'A childhood movie turned into a path toward physics.' }],
    entities: [],
    referenceAssets: [],
    sceneOutline: [],
    sceneOutlineComments: [],
    uploadRequests: [],
    treatment: null,
  }, { latestUserMessage: 'i already said so' });

  assert.match(question, /right|move forward|another chapter/i);
  assert.doesNotMatch(question, /What moment made that part of your life/i);
});

test('tool-only reference replies keep the conversation moving with context', () => {
  const { buildContextualInterviewFollowUp, ensureProactiveDirectorReply } = jiti('../src/lib/director-continuation.ts');

  const fallbackQuestion = buildContextualInterviewFollowUp({
    profile: null,
    timelineEvents: [{ label: 'Garden', description: 'A rainy garden with grandmother.', emotion: 'tender' }],
    memoryCandidates: [],
    entities: [],
    referenceAssets: [],
    sceneOutline: [],
    sceneOutlineComments: [],
    uploadRequests: [],
    treatment: null,
  });

  const reply = ensureProactiveDirectorReply(
    'I will remember Dorian as @dorian_2 for future scenes.',
    { fallbackQuestion },
  );

  assert.match(reply, /I will remember Dorian/);
  assert.match(reply, /Garden|rainy garden|grandmother/i);
  assert.doesNotMatch(reply, /What should we explore next/i);
  assert.equal(
    ensureProactiveDirectorReply('Saved. What happened after that?', { fallbackQuestion: 'What next?' }),
    'Saved. What happened after that?',
  );
});

test('director visible reply selection prefers visible text, then tool-authored replies', () => {
  const { chooseDirectorVisibleReply } = jiti('../src/lib/director-continuation.ts');

  assert.equal(
    chooseDirectorVisibleReply({
      streamedText: 'Already visible?',
      directorReply: 'Ignored model-authored tool reply.',
      chatMessage: 'Ignored tool chat message.',
      fallbackQuestion: 'What did the room feel like?',
    }),
    'Already visible?',
  );

  const toolReply = chooseDirectorVisibleReply({
    streamedText: '',
    directorReply: 'That rainy garden belongs in the film.',
    chatMessage: 'Saved the garden memory.',
    fallbackQuestion: 'What did it smell like after rain?',
  });

  assert.match(toolReply, /rainy garden belongs/);
  assert.match(toolReply, /What did it smell like after rain\?$/);
});

test('director visible reply selection uses chatMessage before contextual fallback', () => {
  const { chooseDirectorVisibleReply } = jiti('../src/lib/director-continuation.ts');

  assert.equal(
    chooseDirectorVisibleReply({
      streamedText: '',
      directorReply: '',
      chatMessage: 'I saved Aunt Lena as a story anchor.',
      fallbackQuestion: 'What changed after that dinner?',
    }),
    'I saved Aunt Lena as a story anchor.\n\nWhat changed after that dinner?',
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

test('pipeline uses LLM continuation instead of canned contextual fallback for normal recovery', () => {
  const source = fs.readFileSync(new URL('../src/lib/pipeline.ts', import.meta.url), 'utf8');

  assert.match(source, /await generateDirectorContinuation\(sessionId,\s*messages,\s*\{/);
  assert.match(source, /blockedReferenceTool[\s\S]{0,260}generateDirectorContinuation/);
  assert.doesNotMatch(source, /finalReply = buildContextualInterviewFollowUp\(loadStoryBucket\(db, sessionId\), \{ latestUserMessage \}\)/);
  assert.doesNotMatch(source, /fallbackQuestion: buildContextualInterviewFollowUp\(loadStoryBucket\(db, sessionId\), \{ latestUserMessage \}\)/);
});
