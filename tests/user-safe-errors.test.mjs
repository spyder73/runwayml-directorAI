import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('production pause messages hide technical runner details', () => {
  const { safeProductionPauseMessage } = jiti('../src/lib/user-safe-errors.ts');

  const message = safeProductionPauseMessage(
    'Final render failed with ffmpeg exit 1: task render_final failed against gpt_image_2 API endpoint',
  );

  assert.doesNotMatch(message, /ffmpeg|task|gpt_image_2|api|endpoint/i);
  assert.match(message, /final cut/i);
});

test('production pause messages categorize retryable media failures', () => {
  const { safeProductionPauseMessage } = jiti('../src/lib/user-safe-errors.ts');

  assert.match(safeProductionPauseMessage('Image prompt failed validation: @self missing'), /scene frame/i);
  assert.match(safeProductionPauseMessage('Video prompt failed validation: no motion'), /motion pass/i);
  assert.match(safeProductionPauseMessage('Runway timeout while polling task-123'), /studio paused/i);
});
