import { NextResponse } from 'next/server';
import db from '@/lib/db';
import type { SessionRow } from '@/lib/types';
import {
  AUTH_SESSION_COOKIE,
  findAuthSessionByToken,
  readSessionTokenFromCookieHeader,
  type AuthSessionWithUser,
} from './session';

type CookieBackedRequest = Request & {
  cookies?: {
    get: (name: string) => { value?: string } | undefined;
  };
};

export class AuthGuardError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuthGuardError';
    this.status = status;
  }
}

function readSessionToken(req: Request) {
  const cookieStore = (req as CookieBackedRequest).cookies;
  return cookieStore?.get(AUTH_SESSION_COOKIE)?.value || readSessionTokenFromCookieHeader(req.headers.get('cookie'));
}

export function getCurrentUser(req: Request): AuthSessionWithUser | null {
  return findAuthSessionByToken(db, readSessionToken(req));
}

export function requireCurrentUser(req: Request): AuthSessionWithUser {
  const auth = getCurrentUser(req);

  if (!auth) {
    throw new AuthGuardError(401, 'Authentication required.');
  }

  if (!auth.user.email_confirmed_at) {
    throw new AuthGuardError(403, 'Confirm your email before continuing.');
  }

  return auth;
}

export function getOwnedSession(sessionId: string, userId: string): SessionRow | null {
  return db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId) as SessionRow | undefined || null;
}

export function requireOwnedSession(sessionId: string, userId: string): SessionRow {
  const session = getOwnedSession(sessionId, userId);

  if (!session) {
    throw new AuthGuardError(404, 'Session not found.');
  }

  return session;
}

export function requireOwnedSessionForRequest(req: Request, sessionId: string) {
  const auth = requireCurrentUser(req);
  const session = requireOwnedSession(sessionId, auth.user.id);
  return { auth, session };
}

export function authGuardResponse(error: unknown) {
  if (error instanceof AuthGuardError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return null;
}
