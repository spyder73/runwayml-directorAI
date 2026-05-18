import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('public landing page embeds the welcome video near registration prompts', () => {
  const source = fs.readFileSync(new URL('../src/components/home/LandingPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /\/landing\/videos\/Welcome\.mp4/);
  assert.match(source, /width=\{1080\}/);
  assert.match(source, /height=\{1920\}/);
  assert.match(source, /aspect-video/);
  assert.match(source, /top-1\/2/);
  assert.match(source, /-translate-y-1\/2/);
  assert.match(source, /max-w-\[min\(88vw,38rem\)\]/);
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

test('public landing page shows two finished-film examples with the newest one first', () => {
  const source = fs.readFileSync(new URL('../src/components/home/LandingPage.tsx', import.meta.url), 'utf8');
  const componentUrl = new URL('../src/components/home/LandingVideoExamples.tsx', import.meta.url);

  assert.match(source, /<LandingVideoExamples \/>/);
  assert.equal(fs.existsSync(componentUrl), true);

  const componentSource = fs.readFileSync(componentUrl, 'utf8');
  assert.match(componentSource, /\/landing\/videos\/example\.mp4[\s\S]*\/landing\/videos\/example_2\.mp4/);
  assert.match(componentSource, /\/landing\/videos\/example-poster\.jpg[\s\S]*\/landing\/videos\/example_2-poster\.jpg/);
  assert.match(componentSource, /grid[\s\S]*md:grid-cols-2/);
});

test('public landing example videos lazy-load behind poster cards', () => {
  const componentUrl = new URL('../src/components/home/LandingVideoExamples.tsx', import.meta.url);
  assert.equal(fs.existsSync(componentUrl), true);

  const source = fs.readFileSync(componentUrl, 'utf8');
  assert.match(source, /^'use client';/);
  assert.match(source, /useState/);
  assert.match(source, /poster cards/i);
  assert.match(source, /selectedExample \?/);
  assert.match(source, /preload="metadata"/);
  assert.doesNotMatch(source, /autoPlay/);
});
