import { NextRequest, NextResponse } from 'next/server';
import { AUTH_SESSION_COOKIE } from './lib/auth/cookies';
import { appPublicUrl, isStudioHost } from './lib/host-routing';

const authPages = new Set(['/login', '/register']);

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const onStudioHost = isStudioHost(host);
  const hasSessionCookie = Boolean(req.cookies.get(AUTH_SESSION_COOKIE)?.value);
  const shouldLiveOnStudioHost = authPages.has(pathname) || pathname.startsWith('/session/');
  const isProtectedPage = (pathname === '/' && onStudioHost) || pathname.startsWith('/session/');

  if (!onStudioHost && shouldLiveOnStudioHost) {
    const appUrl = new URL(pathname, appPublicUrl());
    appUrl.search = req.nextUrl.search;
    return NextResponse.redirect(appUrl);
  }

  if (isProtectedPage && !hasSessionCookie) {
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
  matcher: ['/', '/session/:path*', '/login', '/register'],
};
