import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

const treatment = {
  title: 'Thresholds',
  emotional_thesis: 'Maya learns courage through ordinary thresholds.',
  narrative_arc: 'home to departure to self-recognition',
  visual_motif: 'doorways, station glass, and morning light',
  narrator_style: 'restrained cinematic documentary voice',
  ending_feeling: 'quiet forward motion',
  avoid_json: JSON.stringify(['generic triumph']),
};

const scenes = [
  {
    id: 'scene-1',
    sceneIndex: 0,
    title: 'This Is Maya',
    summary: 'Maya is introduced as someone learning to move through fear.',
    emotionalPurpose: 'Introduce her core tension.',
    imagePrompt: 'Maya stands in dawn light at an open doorway.',
    videoPrompt: 'The camera slowly pushes toward Maya in the doorway.',
    duration: 5,
  },
  {
    id: 'scene-2',
    sceneIndex: 1,
    title: 'The Night Bus',
    summary: 'Maya leaves home with one blue suitcase after a final kitchen goodbye.',
    emotionalPurpose: 'Departure becomes the first act of courage.',
    imagePrompt: 'Wet pavement, a blue suitcase, fluorescent station light.',
    videoPrompt: 'The camera tracks beside the suitcase as the night bus waits.',
    duration: 8,
  },
];

test('whole-film narration prompt carries story context and scene coverage briefs', () => {
  const { buildWholeFilmNarrationPrompt } = jiti('../src/lib/whole-film-narration.ts');

  const prompt = buildWholeFilmNarrationPrompt({
    treatment,
    storyContext: 'Profile: name: Maya; themes: belonging, reinvention. Candidate scenes: Aunt Lena kitchen; The Night Bus.',
    scenes,
    diagnostics: ['scene 2 exceeded its word budget'],
  });

  assert.match(prompt, /complete movie narration/i);
  assert.match(prompt, /literal subtitles\/voiceover/i);
  assert.match(prompt, /one narrator voice/i);
  assert.match(prompt, /do not explain why the clip exists/i);
  assert.match(prompt, /What this scene must cover/i);
  assert.match(prompt, /Maya/);
  assert.match(prompt, /The Night Bus/);
  assert.match(prompt, /scene 2 exceeded its word budget/);
});

test('whole-film narration accepts exact scene-indexed narration', async () => {
  const { planWholeFilmNarration } = jiti('../src/lib/whole-film-narration.ts');
  let calls = 0;

  const result = await planWholeFilmNarration({
    treatment,
    storyContext: 'Maya leaves home and learns how to stay soft.',
    scenes,
    generateNarrationObject: async () => {
      calls += 1;
      return {
        voiceNotes: 'Keep the voice intimate and continuous.',
        scenes: [
          { sceneIndex: 0, narrationText: 'This is Maya, paused at the doorway between fear and motion.' },
          { sceneIndex: 1, narrationText: 'That night, a blue suitcase became the first proof she could leave.' },
        ],
      };
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.scenes.map((scene) => scene.narrationText), [
    'This is Maya, paused at the doorway between fear and motion.',
    'That night, a blue suitcase became the first proof she could leave.',
  ]);
  assert.equal(result.voiceNotes, 'Keep the voice intimate and continuous.');
});

test('whole-film narration provider schema avoids constrained integer fields for Anthropic compatibility', () => {
  const { wholeFilmNarrationSchemaIsAnthropicCompatible } = jiti('../src/lib/whole-film-narration.ts');

  assert.equal(wholeFilmNarrationSchemaIsAnthropicCompatible(), true);
});

test('whole-film narration validation still rejects non-integer scene indexes', () => {
  const { validateWholeFilmNarrationResult } = jiti('../src/lib/whole-film-narration.ts');

  const result = validateWholeFilmNarrationResult({
    scenes: [
      { sceneIndex: 0.5, narrationText: 'This is Maya, paused at the doorway between fear and motion.' },
      { sceneIndex: 1, narrationText: 'That night, a blue suitcase became the first proof she could leave.' },
    ],
  }, scenes);

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /sceneIndex 0\.5/i);
});

test('whole-film narration retries with diagnostics when scene coverage is malformed', async () => {
  const { planWholeFilmNarration } = jiti('../src/lib/whole-film-narration.ts');
  const diagnosticsSeen = [];

  const result = await planWholeFilmNarration({
    treatment,
    storyContext: 'Maya leaves home and learns how to stay soft.',
    scenes,
    maxAttempts: 2,
    generateNarrationObject: async ({ diagnostics }) => {
      diagnosticsSeen.push(diagnostics);
      if (!diagnostics.length) {
        return {
          scenes: [
            { sceneIndex: 0, narrationText: 'This is Maya at the threshold.' },
          ],
        };
      }
      return {
        scenes: [
          { sceneIndex: 0, narrationText: 'This is Maya at the threshold, still brave enough to pause.' },
          { sceneIndex: 1, narrationText: 'The bus did not rescue her; it simply met her decision.' },
        ],
      };
    },
  });

  assert.equal(diagnosticsSeen.length, 2);
  assert.deepEqual(diagnosticsSeen[0], []);
  assert.match(diagnosticsSeen[1].join('\n'), /expected 2 scene narration entries/i);
  assert.equal(result.scenes.length, 2);
});

test('whole-film narration fails closed when valid narration cannot be produced', async () => {
  const { planWholeFilmNarration } = jiti('../src/lib/whole-film-narration.ts');

  await assert.rejects(
    planWholeFilmNarration({
      treatment,
      storyContext: 'Maya leaves home and learns how to stay soft.',
      scenes,
      maxAttempts: 2,
      generateNarrationObject: async () => ({
        scenes: [
          {
            sceneIndex: 0,
            narrationText: 'This is far too long for a five second scene because it keeps wandering through every corner of the memory instead of speaking like a concise film narrator.',
          },
          {
            sceneIndex: 1,
            narrationText: 'This is also far too long for the available scene duration because it tries to carry too much exposition and refuses to become a clean spoken line.',
          },
        ],
      }),
    }),
    /Whole-film narration failed/,
  );
});
