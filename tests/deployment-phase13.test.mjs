import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function readText(pathname) {
  return fs.readFileSync(new URL(pathname, import.meta.url), 'utf8');
}

test('Phase 13 backup script captures SQLite and private media paths', () => {
  const script = readText('../deploy/backup-lifestory.sh');

  assert.match(script, /set -euo pipefail/);
  assert.match(script, /APP_DIR="\$\{APP_DIR:-\/opt\/lifestory\}"/);
  assert.match(script, /BACKUP_DIR="\$\{BACKUP_DIR:-\/opt\/backups\/lifestory\}"/);
  assert.match(script, /DB_PATH="\$APP_DIR\/data\/lifestory\.sqlite"/);
  assert.match(script, /MEDIA_DIR="\$APP_DIR\/data\/media"/);
  assert.match(script, /sqlite3 "\$DB_PATH" "\.backup '\$DB_BACKUP'"/);
  assert.match(script, /tar -czf "\$MEDIA_BACKUP" -C "\$APP_DIR\/data" media/);
  assert.match(script, /date \+%F-%H%M/);
});

test('Phase 13 backup and recovery runbook describes local copy and restore verification', () => {
  const runbook = readText('../deploy/BACKUP_RECOVERY.md');

  for (const phrase of [
    '/opt/lifestory/data/lifestory.sqlite',
    '/opt/lifestory/data/media/',
    '/opt/backups/lifestory',
    'deploy/backup-lifestory.sh',
    'Keep at least one local copy before hackathon judging',
    'docker compose -p lifestory stop web',
    'Restore DB and media into `/opt/lifestory/data/`',
    'docker compose -p lifestory up -d web',
    'Log in and open a completed session',
  ]) {
    assert.match(runbook, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Phase 13 production TODO includes backup and recovery tasks', () => {
  const todo = readText('../deploy/PRODUCTION_TODO.md');

  for (const phrase of [
    '- [ ] Run `deploy/backup-lifestory.sh` after first successful production render.',
    '- [ ] Copy the newest SQLite backup off the VPS.',
    '- [ ] Copy the newest media archive off the VPS.',
    '- [ ] Test recovery by restoring DB and media into `data/`.',
    '- [ ] Open a completed session after recovery.',
  ]) {
    assert.match(todo, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
