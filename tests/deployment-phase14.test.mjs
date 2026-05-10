import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function readText(pathname) {
  return fs.readFileSync(new URL(pathname, import.meta.url), 'utf8');
}

test('Phase 14 acceptance runbook includes local and Docker verification commands', () => {
  const runbook = readText('../deploy/ACCEPTANCE_TESTING.md');

  for (const command of [
    'npm test',
    'npm run build',
    'docker compose -p lifestory --env-file .env.production build',
    'docker compose -p lifestory --env-file .env.production up -d',
    'docker compose -p lifestory logs -f web',
  ]) {
    assert.match(runbook, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Phase 14 acceptance runbook covers production user and security flows', () => {
  const runbook = readText('../deploy/ACCEPTANCE_TESTING.md');

  for (const phrase of [
    'Auth flow',
    'Register a new user',
    'Receive confirmation email',
    'Save OpenRouter key',
    'Save Runway key',
    'never raw keys',
    'User B cannot open User A session URL',
    'User B cannot stream User A media URL',
    '/api/media/<id>',
    'authenticated as owner',
  ]) {
    assert.match(runbook, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Phase 14 acceptance runbook covers media, generation, Remotion, and VPS coexistence', () => {
  const runbook = readText('../deploy/ACCEPTANCE_TESTING.md');

  for (const phrase of [
    'Upload reference image',
    'not publicly accessible from `/public`',
    'video/audio preview supports seeking',
    'Create short Memory session',
    'Generate at least one sketch',
    'Approve treatment/outline',
    'Generate frames',
    'Generate narration and video clips',
    'Render final MP4',
    'final render progress appears',
    'only one final render can run at a time',
    'final video exists under private media storage',
    'logs do not show API keys',
    'New domain serves this app over HTTPS',
    'Existing Docker service/domain still serves over HTTPS',
    'Only shared proxy binds host `80/443`',
  ]) {
    assert.match(runbook, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Phase 14 production TODO links to the acceptance runbook', () => {
  const todo = readText('../deploy/PRODUCTION_TODO.md');

  assert.match(todo, /deploy\/ACCEPTANCE_TESTING\.md/);
  assert.match(todo, /- \[ \] Complete the production acceptance runbook/);
});
