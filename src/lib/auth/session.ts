import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { AuthSessionRow, UserRow } from '@/lib/types';
import { AUTH_SESSION_COOKIE } from './cookies';

type SqliteDatabase = Database.Database;

export { AUTH_SESSION_COOKIE };

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type ClockOptions = {
  now?: Date;
};

export type AuthSessionWithUser = {
  session: AuthSessionRow;
  user: UserRow;
};

function nowDate(options?: ClockOptions) {
  return options?.now || new Date();
}

export function generateSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function getSessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

export function getExpiredSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: new Date(0),
    maxAge: 0,
  };
}

export function createAuthSession(database: SqliteDatabase, userId: string, options?: ClockOptions) {
  const createdAt = nowDate(options);
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
  const token = generateSessionToken();
  const sessionId = uuidv4();

  database.prepare(`
    INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, userId, hashSessionToken(token), expiresAt.toISOString());

  return {
    cookieName: AUTH_SESSION_COOKIE,
    sessionId,
    token,
    expiresAt,
  };
}

export function findAuthSessionByToken(database: SqliteDatabase, token: string | null | undefined, options?: ClockOptions) {
  if (!token) return null;

  const row = database.prepare(`
    SELECT
      auth_sessions.id AS session_id,
      auth_sessions.user_id,
      auth_sessions.token_hash,
      auth_sessions.expires_at,
      auth_sessions.created_at AS session_created_at,
      auth_sessions.last_seen_at,
      auth_sessions.revoked_at,
      users.id AS user_row_id,
      users.email,
      users.password_hash,
      users.email_confirmed_at,
      users.created_at AS user_created_at,
      users.updated_at
    FROM auth_sessions
    INNER JOIN users ON users.id = auth_sessions.user_id
    WHERE auth_sessions.token_hash = ?
      AND auth_sessions.revoked_at IS NULL
      AND auth_sessions.expires_at > ?
    LIMIT 1
  `).get(hashSessionToken(token), nowDate(options).toISOString()) as {
    session_id: string;
    user_id: string;
    token_hash: string;
    expires_at: string;
    session_created_at: string;
    last_seen_at: string | null;
    revoked_at: string | null;
    user_row_id: string;
    email: string;
    password_hash: string;
    email_confirmed_at: string | null;
    user_created_at: string;
    updated_at: string;
  } | undefined;

  if (!row) return null;

  database.prepare('UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.session_id);

  return {
    session: {
      id: row.session_id,
      user_id: row.user_id,
      token_hash: row.token_hash,
      expires_at: row.expires_at,
      created_at: row.session_created_at,
      last_seen_at: row.last_seen_at,
      revoked_at: row.revoked_at,
    },
    user: {
      id: row.user_row_id,
      email: row.email,
      password_hash: row.password_hash,
      email_confirmed_at: row.email_confirmed_at,
      created_at: row.user_created_at,
      updated_at: row.updated_at,
    },
  } satisfies AuthSessionWithUser;
}

export function revokeAuthSessionByToken(database: SqliteDatabase, token: string | null | undefined) {
  if (!token) return false;

  const result = database.prepare(`
    UPDATE auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE token_hash = ? AND revoked_at IS NULL
  `).run(hashSessionToken(token));

  return result.changes > 0;
}

export function readSessionTokenFromCookieHeader(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...valueParts] = part.trim().split('=');
    if (rawName === AUTH_SESSION_COOKIE) {
      return valueParts.join('=') || null;
    }
  }

  return null;
}
