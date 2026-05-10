import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('chat display hides upload logs and vision analysis while preserving image tokens', () => {
  const { splitVisibleMessageContent } = jiti('../src/lib/chat-display.ts');

  const parts = splitVisibleMessageContent(`*User uploaded 1 photo(s)*
[Image: /uploads/selfie.jpg]
*Vision Analysis: A clear portrait in window light.
This line should stay hidden too.
Thank you for adding that.`);

  assert.deepEqual(parts, [
    { type: 'image', url: '/uploads/selfie.jpg' },
    { type: 'text', text: 'Thank you for adding that.' },
  ]);
});
