import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function readText(pathname) {
  return fs.readFileSync(new URL(pathname, import.meta.url), 'utf8');
}

test('Phase 12 VPS setup runbook states the human-only deployment boundary', () => {
  const runbook = readText('../deploy/VPS_SETUP.md');

  for (const phrase of [
    'Human-only deployment boundary',
    'The human operator runs every command',
    'The agent does not have direct VPS shell, Docker, DNS, proxy, firewall, or certificate access',
    'copy back logs, error messages, screenshots, or command output',
  ]) {
    assert.match(runbook, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Phase 12 VPS setup runbook includes ordered bootstrap and launch commands', () => {
  const runbook = readText('../deploy/VPS_SETUP.md');

  for (const command of [
    'docker --version',
    'docker compose version',
    'sudo mkdir -p /opt/lifestory',
    'sudo chown "$USER":"$USER" /opt/lifestory',
    'git clone https://github.com/spyder73/runwayml-directorAI.git .',
    'cp .env.production.example .env.production',
    'openssl rand -base64 32',
    'mkdir -p data',
    'chmod 700 data',
    'docker compose -p lifestory --env-file .env.production up -d --build',
    'docker compose -p lifestory ps',
    'docker compose -p lifestory logs -f web',
    'curl -I https://your-new-domain.com',
    'curl -I https://existing-domain.com',
  ]) {
    assert.match(runbook, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Phase 12 production TODO collects manual VPS operator tasks', () => {
  const todo = readText('../deploy/PRODUCTION_TODO.md');

  for (const phrase of [
    '- [ ] Create `/opt/lifestory`',
    '- [ ] Clone `https://github.com/spyder73/runwayml-directorAI.git`',
    '- [ ] Create `.env.production` from `.env.production.example`',
    '- [ ] Generate `SESSION_SECRET`',
    '- [ ] Generate `CREDENTIAL_ENCRYPTION_KEY`',
    '- [ ] Fill SMTP credentials',
    '- [ ] Fill reviewer credentials and reviewer BYOK keys',
    '- [ ] Create and secure `data/`',
    '- [ ] Start the app with Compose project `lifestory`',
    '- [ ] Wire the existing Caddy reverse proxy',
    '- [ ] Verify the new domain over HTTPS',
    '- [ ] Verify the existing domain still works',
  ]) {
    assert.match(todo, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
