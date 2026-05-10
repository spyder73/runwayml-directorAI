import { NextRequest, NextResponse } from 'next/server';
import { AUTH_SESSION_COOKIE } from './lib/auth/cookies';

const authPages = new Set(['/login', '/register']);

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const hasSessionCookie = Boolean(req.cookies.get(AUTH_SESSION_COOKIE)?.value);

  if (pathname.startsWith('/session/') && !hasSessionCookie) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (authPages.has(pathname) && hasSessionCookie) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/session/:path*', '/login', '/register'],
};
