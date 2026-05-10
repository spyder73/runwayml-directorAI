import { NextResponse, type NextRequest } from 'next/server';

export type AuthPayload = {
  email: string;
  password: string;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function readAuthPayload(req: Request | NextRequest): Promise<AuthPayload> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const body = await req.json() as Partial<AuthPayload>;
    return {
      email: typeof body.email === 'string' ? body.email : '',
      password: typeof body.password === 'string' ? body.password : '',
    };
  }

  const formData = await req.formData();
  return {
    email: String(formData.get('email') || ''),
    password: String(formData.get('password') || ''),
  };
}

export function isFormRequest(req: Request | NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  return contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');
}

export function jsonError(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

function configuredAppUrl() {
  const raw = process.env.APP_URL?.trim();
  if (!raw) return null;

  try {
    return new URL(raw.replace(/\/+$/, '')).toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function appOrigin(req: Request | NextRequest) {
  const configured = configuredAppUrl();
  if (configured) return configured;

  const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (forwardedHost) {
    const host = forwardedHost.split(',')[0]?.trim();
    const proto = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0]?.trim() || 'https';
    if (host) return `${proto}://${host}`;
  }

  return new URL(req.url).origin;
}

export function redirectToApp(req: Request | NextRequest, path: string, init?: ResponseInit) {
  return NextResponse.redirect(new URL(path, appOrigin(req)), init);
}
