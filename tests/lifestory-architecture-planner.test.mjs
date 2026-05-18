import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('LifeStory architecture planner exposes workflow, prompts, tools, state, and change planning views', () => {
  const html = fs.readFileSync(new URL('../docs/lifestory-architecture-planner.html', import.meta.url), 'utf8');

  assert.match(html, /const architectureCatalog =/);
  assert.match(html, /Workflow Map/);
  assert.match(html, /Prompt &amp; LLM Calls|Prompt & LLM Calls/);
  assert.match(html, /Tool Matrix/);
  assert.match(html, /State &amp; Data|State & Data/);
  assert.match(html, /Change Planner/);

  assert.match(html, /Story Bucket/);
  assert.match(html, /OpenRouter/);
  assert.match(html, /Director tools/);
  assert.match(html, /whole-film narration/i);
  assert.match(html, /media_tasks/);
  assert.match(html, /Runway/);
  assert.match(html, /Remotion/);
  assert.match(html, /retry path/i);

  assert.match(html, /localStorage/);
  assert.match(html, /highlightDependencies/);
  assert.match(html, /renderWorkflow/);
});
