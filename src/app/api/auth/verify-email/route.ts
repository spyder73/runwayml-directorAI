import { NextRequest, NextResponse } from 'next/server';
import db from '../../../../lib/db';
import { verifyEmailToken } from '../../../../lib/auth/email-verification';
import { createAuthSession, getSessionCookieOptions } from '../../../../lib/auth/session';

export async function GET(req: NextRequest) {
  const requestUrl = new URL(req.url);
  const token = requestUrl.searchParams.get('token');
  const user = verifyEmailToken(db, token);

  if (!user) {
    return NextResponse.redirect(new URL('/login?verified=invalid', req.url));
  }

  const session = createAuthSession(db, user.id);
  const response = NextResponse.redirect(new URL('/', req.url));
  response.cookies.set(session.cookieName, session.token, getSessionCookieOptions(session.expiresAt));
  return response;
}
