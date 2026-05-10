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
    'add_reference_subject',
    'save_reference_description',
    'generate_memory_sketch',
    'save_sketch_feedback',
    'propose_film_treatment',
    'propose_scene_outline',
    'revise_scene_outline',
    'lock_scene_outline',
  ]);
});

test('add reference subject schema accepts an uploaded reference tag and subject identity', () => {
  const { addReferenceSubjectSchema } = jiti('../src/lib/ai/tools.ts');

  const parsed = addReferenceSubjectSchema.parse({
    referenceTag: 'reference_2',
    subjectType: 'friend',
    displayName: 'Agata',
    relationship: 'school friend',
    description: 'Warm, funny, always wearing bold colors.',
    consentState: 'allowed',
  });

  assert.equal(parsed.referenceTag, 'reference_2');
  assert.equal(parsed.displayName, 'Agata');
  assert.equal(parsed.subjectType, 'friend');
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

test('LifeStory prompt asks for a broad life map before deep cinematic moments', () => {
  const { buildInterviewSystemPrompt } = jiti('../src/lib/ai/prompts/index.ts');
  const onboardingPrompt = buildInterviewSystemPrompt({
    mode: 'life_story',
    status: 'INTERVIEW_ONBOARDING',
    storyContext: '',
    uploadContext: '',
    activeReferenceRequest: null,
  });
  const profilePrompt = buildInterviewSystemPrompt({
    mode: 'life_story',
    status: 'INTERVIEW_PSYCH_PROFILE',
    storyContext: '',
    uploadContext: '',
    activeReferenceRequest: null,
  });

  assert.match(onboardingPrompt, /content director/i);
  assert.match(onboardingPrompt, /name, age, profession/i);
  assert.match(onboardingPrompt, /path that led them here/i);
  assert.match(onboardingPrompt, /Do not use a fixed sentence/i);
  assert.match(onboardingPrompt, /short question/i);
  assert.match(profilePrompt, /promising eras/i);
  assert.match(profilePrompt, /what changed/i);
  assert.match(profilePrompt, /move to another era/i);
});

test('profile bucket tool accepts LifeStory current-life basics', () => {
  const { updateProfileBucketSchema } = jiti('../src/lib/ai/tools.ts');

  const parsed = updateProfileBucketSchema.parse({
    profile: {
      protagonistName: 'Maya',
      age: '41',
      profession: 'architect',
      currentLocation: 'Berlin',
    },
  });

  assert.equal(parsed.profile.profession, 'architect');
  assert.equal(parsed.profile.currentLocation, 'Berlin');
});

test('LifeStory start does not create an opening selfie request', () => {
  const fs = jiti('node:fs');
  const source = fs.readFileSync(new URL('../src/app/api/pipeline/start/route.ts', import.meta.url), 'utf8');

  assert.match(source, /mode === 'single_memory'[\s\S]*createReferenceUploadRequest/);
  assert.doesNotMatch(source, /life_story'[\s\S]{0,240}protagonist reference now/i);
});

test('LifeStory outline prompt asks for missing stories and highlighted experiences before production', () => {
  const { buildInterviewSystemPrompt } = jiti('../src/lib/ai/prompts/index.ts');
  const prompt = buildInterviewSystemPrompt({
    mode: 'life_story',
    status: 'INTERVIEW_DYNAMIC',
    storyContext: 'Profile: Maya, 41',
    uploadContext: '',
    activeReferenceRequest: null,
  });

  assert.match(prompt, /anything important we haven.t touched/i);
  assert.match(prompt, /personal story or experience/i);
  assert.match(prompt, /highlight/i);
  assert.match(prompt, /broad life coverage/i);
});

test('scene outline prompt requires a treatment before outline production', () => {
  const { buildInterviewSystemPrompt } = jiti('../src/lib/ai/prompts/index.ts');
  const prompt = buildInterviewSystemPrompt({
    mode: 'single_memory',
    status: 'INTERVIEW_DYNAMIC',
    storyContext: 'Candidate scenes: The station goodbye.',
    uploadContext: '',
    activeReferenceRequest: null,
  });

  assert.match(prompt, /film treatment/i);
  assert.match(prompt, /propose_film_treatment/i);
});

test('upload checkpoint schema requires an explanation and supports scene-specific references', () => {
  const { requestReferenceUploadSchema } = jiti('../src/lib/ai/tools.ts');

  const parsed = requestReferenceUploadSchema.parse({
    targetType: 'scene_reference',
    targetLabel: 'Daniel at the graduation party',
    promptText: 'You mentioned Daniel in the graduation scene. A photo could help me keep him visually consistent, or you can describe him or skip it.',
    reason: 'Daniel appears in the graduation scene as an important friend.',
    referenceScope: 'scene',
    sceneTitle: 'The graduation party',
  });

  assert.equal(parsed.referenceScope, 'scene');
  assert.equal(parsed.sceneTitle, 'The graduation party');
  assert.throws(() => requestReferenceUploadSchema.parse({
    targetType: 'friend',
    targetLabel: 'Daniel',
    promptText: 'Upload Daniel.',
  }));
});
