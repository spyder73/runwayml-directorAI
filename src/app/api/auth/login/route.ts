import { NextRequest, NextResponse } from 'next/server';
import db from '../../../../lib/db';
import { createAuthSession, getSessionCookieOptions } from '../../../../lib/auth/session';
import { isFormRequest, jsonError, normalizeEmail, readAuthPayload } from '../../../../lib/auth/http';
import { verifyPassword } from '../../../../lib/auth/password';
import type { UserRow } from '@/lib/types';

const INVALID_LOGIN_MESSAGE = 'Invalid email or password.';

function redirectForForm(req: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, req.url), { status: 303 });
}

export async function POST(req: NextRequest) {
  const isForm = isFormRequest(req);
  const payload = await readAuthPayload(req);
  const email = normalizeEmail(payload.email);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;

  if (!user || !(await verifyPassword(payload.password, user.password_hash))) {
    return isForm ? redirectForForm(req, '/login?error=invalid') : jsonError(INVALID_LOGIN_MESSAGE, 401);
  }

  if (!user.email_confirmed_at) {
    return isForm ? redirectForForm(req, '/login?error=confirm-email') : jsonError('Please confirm your email before logging in. Check your inbox or resend the verification email.', 403);
  }

  const session = createAuthSession(db, user.id);
  const response = isForm
    ? redirectForForm(req, '/')
    : NextResponse.json({ ok: true, user: { id: user.id, email: user.email } });

  response.cookies.set(session.cookieName, session.token, getSessionCookieOptions(session.expiresAt));
  return response;
}
