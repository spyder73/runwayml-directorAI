import { NextRequest, NextResponse } from 'next/server';
import db from '../../../../lib/db';
import {
  AUTH_SESSION_COOKIE,
  getExpiredSessionCookieOptions,
  readSessionTokenFromCookieHeader,
  revokeAuthSessionByToken,
} from '../../../../lib/auth/session';

export async function POST(req: NextRequest) {
  const token = req.cookies?.get(AUTH_SESSION_COOKIE)?.value || readSessionTokenFromCookieHeader(req.headers.get('cookie'));
  revokeAuthSessionByToken(db, token);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_SESSION_COOKIE, '', getExpiredSessionCookieOptions());
  return response;
}
