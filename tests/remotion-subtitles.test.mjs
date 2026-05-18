import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('subtitle pagination preserves narration while capping pages at two lines', () => {
  const helperUrl = new URL('../src/remotion/components/subtitle-pagination.ts', import.meta.url);
  assert.ok(fs.existsSync(helperUrl), 'subtitle pagination helper should exist');

  const { splitSubtitleIntoPages } = jiti(fileURLToPath(helperUrl));
  const text = 'The silence of the canyon was loud, but Berlin was a different kind of frequency. A new, electric rhythm. From white-water to pulsing bass, I learned that survival is just the first step. The real adventure is what you do with the energy you find.';

  const pages = splitSubtitleIntoPages(text, 42);

  assert.ok(pages.length > 1);
  assert.equal(
    pages.flatMap((page) => page.map((line) => line.join(' '))).join(' '),
    text,
  );
  for (const page of pages) {
    assert.ok(page.length <= 2);
    for (const line of page) {
      assert.ok(line.join(' ').length <= 42);
    }
  }
});

test('animated subtitles are styled as lower-third typewriter captions', () => {
  const source = fs.readFileSync(new URL('../src/remotion/components/AnimatedSubtitles.tsx', import.meta.url), 'utf8');

  assert.match(source, /top: '66\.666%'/);
  assert.match(source, /fontFamily: .*Courier/);
  assert.match(source, /MAX_SUBTITLE_FONT_SIZE = 30/);
  assert.doesNotMatch(source, /fontFamily: 'Georgia/);
});
