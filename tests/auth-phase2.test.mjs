import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const testDataDir = mkdtempSync(path.join(tmpdir(), 'lifestory-auth-'));
process.env.LIFESTORY_DB_PATH = path.join(testDataDir, 'lifestory.sqlite');
process.env.APP_URL = 'https://lifestory.example';
delete process.env.SMTP_HOST;

function createAuthDb() {
  const { initializeDatabaseSchema } = jiti('../src/lib/db.ts');
  const db = new Database(':memory:');
  initializeDatabaseSchema(db);
  return db;
}

function insertUser(db, id = 'user-1', email = 'user@example.com', confirmedAt = null) {
  db.prepare(`
    INSERT INTO users (id, email, password_hash, email_confirmed_at)
    VALUES (?, ?, ?, ?)
  `).run(id, email, 'placeholder-hash', confirmedAt);
  db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(id);
}

function setCookieHeaders(response) {
  const header = response.headers.get('set-cookie');
  return header ? [header] : [];
}

test('password helper stores scrypt hashes and verifies with timing-safe comparison', async () => {
  const { hashPassword, verifyPassword } = jiti('../src/lib/auth/password.ts');

  await assert.rejects(() => hashPassword('short'), /at least 8/);

  const encoded = await hashPassword('correct horse battery staple');
  assert.match(encoded, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPassword('correct horse battery staple', encoded), true);
  assert.equal(await verifyPassword('wrong horse battery staple', encoded), false);
  assert.equal(await verifyPassword('correct horse battery staple', 'not-a-valid-hash'), false);
});

test('session helper stores only token hashes and exposes hardened cookie attributes', () => {
  const {
    AUTH_SESSION_COOKIE,
    createAuthSession,
    findAuthSessionByToken,
    getSessionCookieOptions,
    hashSessionToken,
    revokeAuthSessionByToken,
  } = jiti('../src/lib/auth/session.ts');
  const db = createAuthDb();
  insertUser(db);

  const session = createAuthSession(db, 'user-1', { now: new Date('2026-05-10T12:00:00.000Z') });
  assert.equal(session.cookieName, AUTH_SESSION_COOKIE);
  assert.equal(session.token.length >= 40, true);
  assert.equal(session.expiresAt.toISOString(), '2026-05-24T12:00:00.000Z');

  const row = db.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(session.sessionId);
  assert.notEqual(row.token_hash, session.token);
  assert.equal(row.token_hash, hashSessionToken(session.token));

  const found = findAuthSessionByToken(db, session.token, { now: new Date('2026-05-11T12:00:00.000Z') });
  assert.equal(found?.user.id, 'user-1');
  assert.equal(found?.user.email, 'user@example.com');

  const cookieOptions = getSessionCookieOptions(session.expiresAt);
  assert.deepEqual(cookieOptions, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt,
  });

  assert.equal(revokeAuthSessionByToken(db, session.token), true);
  assert.equal(findAuthSessionByToken(db, session.token), null);
});

test('email verification tokens confirm users once and reject expired or reused tokens', () => {
  const {
    createEmailVerificationToken,
    hashEmailVerificationToken,
    verifyEmailToken,
  } = jiti('../src/lib/auth/email-verification.ts');
  const db = createAuthDb();
  insertUser(db, 'user-verify', 'verify@example.com');

  const token = createEmailVerificationToken(db, 'user-verify', {
    now: new Date('2026-05-10T12:00:00.000Z'),
  });
  const stored = db.prepare('SELECT * FROM email_verification_tokens WHERE user_id = ?').get('user-verify');
  assert.equal(stored.token_hash, hashEmailVerificationToken(token.token));
  assert.equal(stored.expires_at, '2026-05-11T12:00:00.000Z');

  const verified = verifyEmailToken(db, token.token, { now: new Date('2026-05-10T12:30:00.000Z') });
  assert.equal(verified?.id, 'user-verify');
  assert.match(db.prepare('SELECT email_confirmed_at FROM users WHERE id = ?').get('user-verify').email_confirmed_at, /^2026-05-10/);
  assert.equal(verifyEmailToken(db, token.token, { now: new Date('2026-05-10T13:00:00.000Z') }), null);

  const expired = createEmailVerificationToken(db, 'user-verify', {
    now: new Date('2026-05-10T12:00:00.000Z'),
  });
  assert.equal(verifyEmailToken(db, expired.token, { now: new Date('2026-05-12T12:00:00.000Z') }), null);
});

test('SMTP envelope addresses use bare mailboxes for friendly From headers', () => {
  const { smtpEnvelopeAddress } = jiti('../src/lib/email/smtp.ts');

  assert.equal(smtpEnvelopeAddress('no-reply@example.com'), '<no-reply@example.com>');
  assert.equal(smtpEnvelopeAddress('<no-reply@example.com>'), '<no-reply@example.com>');
  assert.equal(smtpEnvelopeAddress('Lifestory <no-reply@example.com>'), '<no-reply@example.com>');
});

test('final render email links to the render finished page when session id is available', () => {
  const { buildFinalRenderUrl } = jiti('../src/lib/email/smtp.ts');
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://app.example.com/';

  try {
    assert.equal(buildFinalRenderUrl('/api/media/final-video', 'session 1'), 'https://app.example.com/render/session%201');
    assert.equal(buildFinalRenderUrl('/api/media/final-video'), 'https://app.example.com/api/media/final-video');
  } finally {
    if (previousAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousAppUrl;
    }
  }
});

test('final render notifications include extra render email and account email once each', () => {
  const { finalRenderNotificationRecipients } = jiti('../src/lib/final-render-notification.ts');

  assert.deepEqual(
    finalRenderNotificationRecipients({
      render_notification_email: 'film@example.com',
      account_email: 'owner@example.com',
    }),
    ['film@example.com', 'owner@example.com'],
  );
  assert.deepEqual(
    finalRenderNotificationRecipients({
      render_notification_email: 'OWNER@example.com',
      account_email: 'owner@example.com',
    }),
    ['owner@example.com'],
  );
});

test('auth routes register, require confirmation for login, verify email, login, and logout', async () => {
  const dbModule = jiti('../src/lib/db.ts');
  const db = dbModule.default;
  db.prepare('DELETE FROM auth_sessions').run();
  db.prepare('DELETE FROM email_verification_tokens').run();
  db.prepare('DELETE FROM user_settings').run();
  db.prepare('DELETE FROM users').run();

  const registerRoute = jiti('../src/app/api/auth/register/route.ts');
  const loginRoute = jiti('../src/app/api/auth/login/route.ts');
  const verifyRoute = jiti('../src/app/api/auth/verify-email/route.ts');
  const logoutRoute = jiti('../src/app/api/auth/logout/route.ts');
  const { createEmailVerificationToken } = jiti('../src/lib/auth/email-verification.ts');
  const { AUTH_SESSION_COOKIE, hashSessionToken } = jiti('../src/lib/auth/session.ts');

  const registerResponse = await registerRoute.POST(new Request('https://lifestory.example/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: '  New.User@Example.COM  ', password: 'supersecret' }),
  }));
  assert.equal(registerResponse.status, 201);
  const registered = await registerResponse.json();
  assert.equal(registered.ok, true);
  assert.equal(registered.verificationEmailSent, false);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('new.user@example.com');
  assert.equal(user.email_confirmed_at, null);
  assert.equal(db.prepare('SELECT runway_concurrency_mode FROM user_settings WHERE user_id = ?').get(user.id).runway_concurrency_mode, 'serial');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM email_verification_tokens WHERE user_id = ?').get(user.id).count, 1);

  const unconfirmedLogin = await loginRoute.POST(new Request('https://lifestory.example/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'new.user@example.com', password: 'supersecret' }),
  }));
  assert.equal(unconfirmedLogin.status, 403);
  assert.match((await unconfirmedLogin.json()).error, /confirm/i);

  const invalidLogin = await loginRoute.POST(new Request('https://lifestory.example/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'missing@example.com', password: 'wrongwrong' }),
  }));
  assert.equal(invalidLogin.status, 401);
  assert.equal((await invalidLogin.json()).error, 'Invalid email or password.');

  const verification = createEmailVerificationToken(db, user.id);
  const verifyResponse = await verifyRoute.GET(new Request(`https://lifestory.example/api/auth/verify-email?token=${verification.token}`));
  assert.equal(verifyResponse.status, 307);
  assert.equal(verifyResponse.headers.get('location'), 'https://lifestory.example/');
  assert.match(db.prepare('SELECT email_confirmed_at FROM users WHERE id = ?').get(user.id).email_confirmed_at, /^\d{4}-\d{2}-\d{2}/);

  const verifyCookie = setCookieHeaders(verifyResponse).join('\n');
  assert.match(verifyCookie, new RegExp(`${AUTH_SESSION_COOKIE}=`));
  assert.match(verifyCookie, /HttpOnly/i);
  assert.match(verifyCookie, /SameSite=Lax/i);

  const loginResponse = await loginRoute.POST(new Request('https://lifestory.example/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'NEW.USER@example.com', password: 'supersecret' }),
  }));
  assert.equal(loginResponse.status, 200);
  const loginCookie = loginResponse.headers.get('set-cookie') || '';
  const cookieMatch = loginCookie.match(new RegExp(`${AUTH_SESSION_COOKIE}=([^;]+)`));
  assert.ok(cookieMatch);
  assert.equal(db.prepare('SELECT 1 FROM auth_sessions WHERE token_hash = ?').get(hashSessionToken(cookieMatch[1]))?.['1'], 1);

  const formLoginResponse = await loginRoute.POST(new Request('http://0.0.0.0:3000/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'new.user@example.com', password: 'supersecret' }).toString(),
  }));
  assert.equal(formLoginResponse.status, 303);
  assert.equal(formLoginResponse.headers.get('location'), 'https://lifestory.example/');

  const formRegisterResponse = await registerRoute.POST(new Request('http://0.0.0.0:3000/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'form.user@example.com', password: 'supersecret' }).toString(),
  }));
  assert.equal(formRegisterResponse.status, 303);
  assert.equal(formRegisterResponse.headers.get('location'), 'https://lifestory.example/login?registered=1');

  const logoutResponse = await logoutRoute.POST(new Request('https://lifestory.example/api/auth/logout', {
    method: 'POST',
    headers: { cookie: `${AUTH_SESSION_COOKIE}=${cookieMatch[1]}` },
  }));
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers.get('set-cookie') || '', new RegExp(`${AUTH_SESSION_COOKIE}=;`));
  assert.notEqual(db.prepare('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?').get(hashSessionToken(cookieMatch[1])).revoked_at, null);
});

test('proxy uses only session cookie presence for optimistic auth redirects', () => {
  const proxySource = readFileSync(new URL('../src/proxy.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(proxySource, /lib\/db|@\/lib\/db|better-sqlite3/);

  const { proxy } = jiti('../src/proxy.ts');
  const { NextRequest } = jiti('next/server');

  const protectedResponse = proxy(new NextRequest('https://lifestory.example/session/session-1'));
  assert.equal(protectedResponse.status, 307);
  assert.equal(protectedResponse.headers.get('location'), 'https://lifestory.example/login?next=%2Fsession%2Fsession-1');

  const loginResponse = proxy(new NextRequest('https://lifestory.example/login', {
    headers: { cookie: 'lifestory_session=plain-session-token' },
  }));
  assert.equal(loginResponse.status, 307);
  assert.equal(loginResponse.headers.get('location'), 'https://lifestory.example/');
});
