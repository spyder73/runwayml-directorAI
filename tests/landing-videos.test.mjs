import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('public landing page embeds the welcome video near registration prompts', () => {
  const source = fs.readFileSync(new URL('../src/components/home/LandingPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /\/landing\/videos\/Welcome\.mp4/);
  assert.match(source, /width=\{1080\}/);
  assert.match(source, /height=\{1920\}/);
  assert.match(source, /object-contain/);
  assert.match(source, /max-w-\[min\(88vw,34rem\)\]/);
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
