import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('login page hides resend confirmation on the default sign-in view', () => {
  const source = fs.readFileSync(new URL('../src/app/login/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /const showResendConfirmation =/);
  assert.match(source, /params\.registered === '1'/);
  assert.match(source, /params\.error === 'confirm-email'/);
  assert.match(source, /params\.verified === 'invalid'/);
  assert.match(source, /\{showResendConfirmation && \(/);
  assert.match(source, /action="\/api\/auth\/resend-verification"/);
});
