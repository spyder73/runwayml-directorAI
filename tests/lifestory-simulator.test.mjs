import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('LifeStory pipeline simulator renders bucket, OpenRouter mocks, scenes, subtitles, and subscenes', () => {
  const html = fs.readFileSync(new URL('../docs/lifestory-pipeline-simulator.html', import.meta.url), 'utf8');

  assert.match(html, /Story bucket/i);
  assert.match(html, /OpenRouter mock/i);
  assert.match(html, /Whole-film narration request/i);
  assert.match(html, /Scene-wise subtitles/i);
  assert.match(html, /Timing checks/i);
  assert.match(html, /Subscene plan/i);
  assert.match(html, /Maya/i);
});
