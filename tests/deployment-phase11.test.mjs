import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function readText(pathname) {
  return fs.readFileSync(new URL(pathname, import.meta.url), 'utf8');
}

test('Phase 11 compose gives the shared proxy a stable app hostname without host 80 or 443 binds', () => {
  const compose = readText('../docker-compose.yml');

  assert.match(compose, /container_name:\s*lifestory-web/);
  assert.match(compose, /expose:\s*\n\s*-\s*"3000"/);
  assert.match(compose, /proxy:\s*\n\s*external:\s*true/);
  assert.doesNotMatch(compose, /["']?(?:0\.0\.0\.0:)?(?:80|443):/);
});

test('Phase 11 Caddy example preserves SSE and upload behavior behind the shared proxy', () => {
  const caddyfile = readText('../deploy/caddy/Caddyfile.example');

  assert.match(caddyfile, /your-new-domain\.com, www\.your-new-domain\.com/);
  assert.match(caddyfile, /request_body\s*\{\s*max_size 25MB\s*\}/);
  assert.match(caddyfile, /reverse_proxy \/api\/pipeline\/events\* lifestory-web:3000/);
  assert.match(caddyfile, /flush_interval -1/);
  assert.match(caddyfile, /read_timeout 1h/);
  assert.match(caddyfile, /reverse_proxy lifestory-web:3000/);
  assert.doesNotMatch(caddyfile, /:80|:443/);
});

test('Phase 11 nginx example includes upload caps, SSE buffering disablement, and coarse limits', () => {
  const nginx = readText('../deploy/nginx/lifestory.conf.example');

  assert.match(nginx, /server_name your-new-domain\.com www\.your-new-domain\.com/);
  assert.match(nginx, /client_max_body_size 25m/);
  assert.match(nginx, /proxy_pass http:\/\/lifestory-web:3000/);
  assert.match(nginx, /location \/api\/pipeline\/events/);
  assert.match(nginx, /proxy_buffering off/);
  assert.match(nginx, /proxy_read_timeout 3600s/);
  assert.match(nginx, /X-Forwarded-For/);
  assert.match(nginx, /limit_req_zone/);
  assert.match(nginx, /lifestory_auth/);
  assert.match(nginx, /lifestory_upload/);
});

test('Phase 11 reverse proxy handoff captures manual VPS steps', () => {
  const handoff = readText('../deploy/REVERSE_PROXY.md');

  for (const phrase of [
    'Add an A record',
    'AAAA',
    'docker ps',
    "sudo ss -tulpn | grep -E ':80|:443'",
    'Do not start a second public reverse proxy',
    'Caddy',
    'docker network inspect proxy',
    'docker network create proxy',
    '127.0.0.1:3001:3000',
    'copy .env.production.example .env.production',
  ]) {
    assert.match(handoff, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
