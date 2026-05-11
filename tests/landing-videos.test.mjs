import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('public landing page embeds the welcome video near registration prompts', () => {
  const source = fs.readFileSync(new URL('../src/components/home/LandingPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /\/landing\/videos\/Welcome\.mp4/);
  assert.match(source, /autoPlay/);
  assert.match(source, /muted/);
  assert.match(source, /playsInline/);
  assert.match(source, /href=\{`\$\{appUrl\}\/register`\}/);
});

test('studio home embeds the before-start video below the life story start box', () => {
  const source = fs.readFileSync(new URL('../src/components/home/StudioHome.tsx', import.meta.url), 'utf8');

  assert.match(source, /\/landing\/videos\/BeforeStart\.mp4/);
  assert.match(source, /Describe Your Life Story[\s\S]*\/landing\/videos\/BeforeStart\.mp4/);
  assert.match(source, /autoPlay/);
  assert.match(source, /muted/);
  assert.match(source, /playsInline/);
});
