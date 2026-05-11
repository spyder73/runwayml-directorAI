import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

function bucket(overrides = {}) {
  return {
    profile: null,
    entities: [],
    referenceAssets: [],
    memoryCandidates: [],
    sceneOutline: [],
    sceneOutlineComments: [],
    uploadRequests: [],
    timelineEvents: [],
    ...overrides,
  };
}

test('LifeStory outline readiness blocks outline without broad life map and deep moments', () => {
  const { evaluateLifeStoryOutlineReadiness } = jiti('../src/lib/story-readiness.ts');

  const result = evaluateLifeStoryOutlineReadiness(bucket({
    profile: {
      protagonist_name: 'Maya',
      age: '41',
      life_phase: null,
      summary: null,
      themes_json: '[]',
    },
    timelineEvents: [
      { label: 'Childhood', description: 'Grew up near the sea.' },
    ],
  }));

  assert.equal(result.ready, false);
  assert.match(result.nextQuestion, /broad shape/i);
  assert.ok(result.missing.includes('current life phase'));
  assert.ok(result.missing.includes('deeper emotionally specific moments'));
});

test('LifeStory outline readiness waits for three highlighted emotional moments', () => {
  const { evaluateLifeStoryOutlineReadiness } = jiti('../src/lib/story-readiness.ts');

  const result = evaluateLifeStoryOutlineReadiness(bucket({
    profile: {
      protagonist_name: 'Maya',
      age: '41',
      life_phase: 'starting over in a new city',
      summary: 'Maya is rebuilding her life after leaving home.',
      themes_json: JSON.stringify(['belonging', 'reinvention']),
    },
    entities: [
      { display_name: 'Aunt Lena', type: 'family' },
      { display_name: 'Daniel', type: 'friend' },
    ],
    timelineEvents: [
      { label: 'Childhood', description: 'Grew up near the sea.' },
      { label: 'School', description: 'Found her first real friends.' },
      { label: 'Leaving home', description: 'Took a night bus with one suitcase.' },
      { label: 'Now', description: 'Learning how to feel at home again.' },
    ],
    memoryCandidates: [
      {
        title: 'The night bus',
        description: 'Maya left home with one suitcase.',
        emotional_purpose: 'The first act of courage.',
        visual_summary: 'Wet pavement, blue suitcase, fluorescent station lights.',
      },
      {
        title: 'Aunt Lena kitchen',
        description: 'Aunt Lena taught Maya to cook after school.',
        emotional_purpose: 'Love expressed through routine.',
        visual_summary: 'Steam on windows, yellow kitchen light, cedar smell.',
      },
    ],
  }));

  assert.equal(result.ready, false);
  assert.ok(result.missing.includes('deeper emotionally specific moments'));
});

test('LifeStory outline readiness passes with broad coverage and three highlighted emotional moments', () => {
  const { evaluateLifeStoryOutlineReadiness } = jiti('../src/lib/story-readiness.ts');

  const result = evaluateLifeStoryOutlineReadiness(bucket({
    profile: {
      protagonist_name: 'Maya',
      age: '41',
      life_phase: 'starting over in a new city',
      summary: 'Maya is rebuilding her life after leaving home.',
      themes_json: JSON.stringify(['belonging', 'reinvention']),
    },
    entities: [
      { display_name: 'Aunt Lena', type: 'family' },
      { display_name: 'Daniel', type: 'friend' },
    ],
    timelineEvents: [
      { label: 'Childhood', description: 'Grew up near the sea.' },
      { label: 'School', description: 'Found her first real friends.' },
      { label: 'Leaving home', description: 'Took a night bus with one suitcase.' },
      { label: 'Now', description: 'Learning how to feel at home again.' },
    ],
    memoryCandidates: [
      {
        title: 'The night bus',
        description: 'Maya left home with one suitcase.',
        emotional_purpose: 'The first act of courage.',
        visual_summary: 'Wet pavement, blue suitcase, fluorescent station lights.',
      },
      {
        title: 'Aunt Lena kitchen',
        description: 'Aunt Lena taught Maya to cook after school.',
        emotional_purpose: 'Love expressed through routine.',
        visual_summary: 'Steam on windows, yellow kitchen light, cedar smell.',
      },
      {
        title: 'First morning alone',
        description: 'Maya woke up in the new apartment and chose to stay.',
        emotional_purpose: 'Hope after loneliness.',
        visual_summary: 'A thin line of morning light on the floor, cardboard boxes, a kettle clicking on.',
      },
    ],
  }));

  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.sceneReadinessScores.length, 3);
  assert.ok(result.sceneReadinessScores[0].visualSpecificity >= 0.7);
  assert.ok(result.sceneReadinessScores[0].emotionalClarity >= 0.7);
});

test('LifeStory readiness asks a visual gap question for abstract moments', () => {
  const { evaluateLifeStoryOutlineReadiness } = jiti('../src/lib/story-readiness.ts');

  const result = evaluateLifeStoryOutlineReadiness(bucket({
    profile: {
      protagonist_name: 'Maya',
      age: '41',
      life_phase: 'starting over',
      summary: 'Maya is rebuilding after a move.',
      themes_json: JSON.stringify(['belonging']),
    },
    entities: [
      { display_name: 'Aunt Lena', type: 'family' },
      { display_name: 'Berlin', type: 'place' },
    ],
    timelineEvents: [
      { label: 'Childhood', description: 'Grew up near the sea.' },
      { label: 'Leaving', description: 'Moved away.' },
      { label: 'Now', description: 'Trying again.' },
    ],
    memoryCandidates: [
      {
        title: 'Starting over',
        description: 'Maya felt everything changing.',
        emotional_purpose: 'A turning point.',
        visual_summary: null,
      },
      {
        title: 'The apartment',
        description: 'Maya sat in the first apartment.',
        emotional_purpose: 'Learning to be alone.',
        visual_summary: 'Bare mattress, yellow streetlight, rain on the window.',
      },
    ],
  }));

  assert.equal(result.ready, false);
  assert.match(result.nextQuestion, /visual detail/i);
  assert.ok(result.sceneReadinessScores.some((score) => score.visualSpecificity < 0.7));
});
