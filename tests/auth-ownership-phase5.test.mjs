import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  alias: {
    '@': path.join(process.cwd(), 'src'),
  },
});
const testDataDir = mkdtempSync(path.join(tmpdir(), 'lifestory-ownership-'));
process.env.LIFESTORY_DB_PATH = path.join(testDataDir, 'lifestory.sqlite');
process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64');
delete process.env.REVIEWER_EMAIL;
delete process.env.REVIEWER_PASSWORD;

function testDb() {
  return jiti('../src/lib/db.ts').default;
}

function resetDb(db) {
  db.pragma('foreign_keys = OFF');
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all();
  for (const { name } of tables) {
    db.prepare(`DELETE FROM ${name}`).run();
  }
  db.pragma('foreign_keys = ON');
}

function insertUser(db, id, confirmed = true) {
  db.prepare(`
    INSERT INTO users (id, email, password_hash, email_confirmed_at)
    VALUES (?, ?, ?, ?)
  `).run(id, `${id}@example.com`, 'placeholder-hash', confirmed ? '2026-05-10T12:00:00.000Z' : null);
  db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(id);
}

function insertSession(db, id, userId) {
  db.prepare(`
    INSERT INTO sessions (id, user_id, status, story_text, aspect_ratio, mode)
    VALUES (?, ?, 'INTERVIEW_DYNAMIC', '', '16:9', 'life_story')
  `).run(id, userId);
}

function cookieFor(db, userId) {
  const { AUTH_SESSION_COOKIE, createAuthSession } = jiti('../src/lib/auth/session.ts');
  const authSession = createAuthSession(db, userId);
  return `${AUTH_SESSION_COOKIE}=${authSession.token}`;
}

function requestHeaders(cookie) {
  return cookie ? { cookie } : undefined;
}

function jsonRequest(pathname, body, cookie) {
  return new Request(`https://lifestory.example${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function uploadRequest(sessionId, cookie) {
  const formData = new FormData();
  formData.set('sessionId', sessionId);
  return new Request('https://lifestory.example/api/pipeline/upload', {
    method: 'POST',
    headers: requestHeaders(cookie),
    body: formData,
  });
}

test('auth guards resolve confirmed users and enforce session ownership', () => {
  const db = testDb();
  resetDb(db);
  insertUser(db, 'owner');
  insertUser(db, 'stranger');
  insertUser(db, 'unconfirmed', false);
  insertSession(db, 'owned-session', 'owner');

  const ownerCookie = cookieFor(db, 'owner');
  const unconfirmedCookie = cookieFor(db, 'unconfirmed');
  const {
    AuthGuardError,
    getCurrentUser,
    getOwnedSession,
    requireCurrentUser,
    requireOwnedSession,
  } = jiti('../src/lib/auth/guards.ts');

  assert.equal(getCurrentUser(new Request('https://lifestory.example/')), null);
  assert.equal(requireCurrentUser(new Request('https://lifestory.example/', { headers: { cookie: ownerCookie } })).user.id, 'owner');
  assert.throws(
    () => requireCurrentUser(new Request('https://lifestory.example/', { headers: { cookie: unconfirmedCookie } })),
    (error) => error instanceof AuthGuardError && error.status === 403,
  );

  assert.equal(getOwnedSession('owned-session', 'owner')?.id, 'owned-session');
  assert.equal(getOwnedSession('owned-session', 'stranger'), null);
  assert.throws(
    () => requireOwnedSession('owned-session', 'stranger'),
    (error) => error instanceof AuthGuardError && error.status === 404,
  );
});

test('start and readiness routes require confirmed auth and create user-owned sessions', async () => {
  const db = testDb();
  resetDb(db);
  insertUser(db, 'owner');
  insertUser(db, 'unconfirmed', false);

  const ownerCookie = cookieFor(db, 'owner');
  const unconfirmedCookie = cookieFor(db, 'unconfirmed');
  const startRoute = jiti('../src/app/api/pipeline/start/route.ts');
  const readinessRoute = jiti('../src/app/api/pipeline/readiness/route.ts');

  const missingAuth = await startRoute.POST(jsonRequest('/api/pipeline/start', {}));
  assert.equal(missingAuth.status, 401);

  const unconfirmed = await startRoute.POST(jsonRequest('/api/pipeline/start', {}, unconfirmedCookie));
  assert.equal(unconfirmed.status, 403);

  const started = await startRoute.POST(jsonRequest('/api/pipeline/start', { mode: 'single_memory', interviewMedium: 'voice' }, ownerCookie));
  assert.equal(started.status, 200);
  const startedJson = await started.json();
  const startedSession = db.prepare('SELECT user_id, mode, interview_medium, render_notification_email FROM sessions WHERE id = ?').get(startedJson.sessionId);
  assert.equal(startedSession.user_id, 'owner');
  assert.equal(startedSession.mode, 'life_story');
  assert.equal(startedSession.interview_medium, 'voice');
  assert.equal(startedSession.render_notification_email, 'owner@example.com');

  assert.equal((await readinessRoute.GET(new Request('https://lifestory.example/api/pipeline/readiness'))).status, 401);
  assert.equal((await readinessRoute.GET(new Request('https://lifestory.example/api/pipeline/readiness', { headers: { cookie: unconfirmedCookie } }))).status, 403);
  assert.equal((await readinessRoute.GET(new Request('https://lifestory.example/api/pipeline/readiness', { headers: { cookie: ownerCookie } }))).status, 200);
});

test('pipeline session routes reject missing, unconfirmed, and foreign session access', async () => {
  const db = testDb();
  resetDb(db);
  insertUser(db, 'owner');
  insertUser(db, 'stranger');
  insertUser(db, 'unconfirmed', false);
  insertSession(db, 'owned-session', 'owner');

  const strangerCookie = cookieFor(db, 'stranger');
  const unconfirmedCookie = cookieFor(db, 'unconfirmed');
  const routes = {
    director: jiti('../src/app/api/pipeline/director/route.ts'),
    events: jiti('../src/app/api/pipeline/events/route.ts'),
    interview: jiti('../src/app/api/pipeline/interview/route.ts'),
    outline: jiti('../src/app/api/pipeline/outline/route.ts'),
    referenceRequest: jiti('../src/app/api/pipeline/reference-request/route.ts'),
    render: jiti('../src/app/api/pipeline/render/route.ts'),
    retry: jiti('../src/app/api/pipeline/retry/route.ts'),
    sketchFeedback: jiti('../src/app/api/pipeline/sketch-feedback/route.ts'),
    synthesize: jiti('../src/app/api/pipeline/synthesize/route.ts'),
    upload: jiti('../src/app/api/pipeline/upload/route.ts'),
    renderEmail: jiti('../src/app/api/pipeline/render-email/route.ts'),
    avatarSession: jiti('../src/app/api/avatar/session/route.ts'),
  };

  const calls = [
    ['director', (cookie) => routes.director.POST(jsonRequest('/api/pipeline/director', { sessionId: 'owned-session', message: 'Revise scene one.' }, cookie))],
    ['events', (cookie) => routes.events.GET(new Request('https://lifestory.example/api/pipeline/events?sessionId=owned-session', { headers: requestHeaders(cookie) }))],
    ['interview', (cookie) => routes.interview.POST(jsonRequest('/api/pipeline/interview', { sessionId: 'owned-session', message: 'Hello.' }, cookie))],
    ['outline', (cookie) => routes.outline.POST(jsonRequest('/api/pipeline/outline', { sessionId: 'owned-session', action: 'lock' }, cookie))],
    ['reference-request', (cookie) => routes.referenceRequest.POST(jsonRequest('/api/pipeline/reference-request', { sessionId: 'owned-session', status: 'skipped' }, cookie))],
    ['render', (cookie) => routes.render.POST(jsonRequest('/api/pipeline/render', { sessionId: 'owned-session' }, cookie))],
    ['retry', (cookie) => routes.retry.POST(jsonRequest('/api/pipeline/retry', { sessionId: 'owned-session' }, cookie))],
    ['sketch-feedback', (cookie) => routes.sketchFeedback.POST(jsonRequest('/api/pipeline/sketch-feedback', { sessionId: 'owned-session', candidateId: 'missing', feedback: 'accepted' }, cookie))],
    ['synthesize', (cookie) => routes.synthesize.POST(jsonRequest('/api/pipeline/synthesize', { sessionId: 'owned-session' }, cookie))],
    ['upload', (cookie) => routes.upload.POST(uploadRequest('owned-session', cookie))],
    ['render-email', (cookie) => routes.renderEmail.POST(jsonRequest('/api/pipeline/render-email', { sessionId: 'owned-session', email: 'film@example.com' }, cookie))],
    ['avatar-session', (cookie) => routes.avatarSession.POST(jsonRequest('/api/avatar/session', { appSessionId: 'owned-session', avatarId: 'avatar-123' }, cookie))],
  ];

  for (const [name, call] of calls) {
    assert.equal((await call()).status, 401, `${name} should require auth`);
    assert.equal((await call(unconfirmedCookie)).status, 403, `${name} should require confirmed auth`);
    assert.equal((await call(strangerCookie)).status, 404, `${name} should hide foreign sessions`);
  }
});

test('Phase 5 surfaces are wired through auth and SSE buffering stays disabled', () => {
  const protectedRoutes = [
    'director',
    'events',
    'interview',
    'outline',
    'readiness',
    'reference-request',
    'render',
    'retry',
    'sketch-feedback',
    'start',
    'synthesize',
    'upload',
    'render-email',
  ];

  for (const routeName of protectedRoutes) {
    const source = readFileSync(new URL(`../src/app/api/pipeline/${routeName}/route.ts`, import.meta.url), 'utf8');
    assert.match(source, /auth\/guards/, `${routeName} should import auth guards`);
  }

  const eventsSource = readFileSync(new URL('../src/app/api/pipeline/events/route.ts', import.meta.url), 'utf8');
  assert.match(eventsSource, /X-Accel-Buffering/);
  assert.match(eventsSource, /no-cache, no-transform/);

  const pageSource = readFileSync(new URL('../src/components/home/StudioHome.tsx', import.meta.url), 'utf8');
  assert.match(pageSource, /login\?next=/);

  const proxySource = readFileSync(new URL('../src/proxy.ts', import.meta.url), 'utf8');
  assert.equal(proxySource.includes("pathname === '/'"), true);

  const avatarSource = readFileSync(new URL('../src/app/api/avatar/session/route.ts', import.meta.url), 'utf8');
  assert.match(avatarSource, /auth\/guards/);
  assert.match(avatarSource, /requireOwnedSessionForRequest/);
});
