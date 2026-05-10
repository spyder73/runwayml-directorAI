import { NextRequest } from 'next/server';
import db from '../../../../lib/db';
import { verifyEmailToken } from '../../../../lib/auth/email-verification';
import { createAuthSession, getSessionCookieOptions } from '../../../../lib/auth/session';
import { redirectToApp } from '../../../../lib/auth/http';

export async function GET(req: NextRequest) {
  const requestUrl = new URL(req.url);
  const token = requestUrl.searchParams.get('token');
  const user = verifyEmailToken(db, token);

  if (!user) {
    return redirectToApp(req, '/login?verified=invalid');
  }

  const session = createAuthSession(db, user.id);
  const response = redirectToApp(req, '/');
  response.cookies.set(session.cookieName, session.token, getSessionCookieOptions(session.expiresAt));
  return response;
}
