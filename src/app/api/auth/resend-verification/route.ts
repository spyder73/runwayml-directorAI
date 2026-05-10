import { NextRequest, NextResponse } from 'next/server';
import db from '../../../../lib/db';
import { createEmailVerificationToken } from '../../../../lib/auth/email-verification';
import { isFormRequest, normalizeEmail, redirectToApp } from '../../../../lib/auth/http';
import { sendVerificationEmail } from '../../../../lib/email/smtp';
import {
  RESEND_EMAIL_RATE_LIMIT,
  checkRateLimit,
  rateLimitKey,
  rateLimitResponse,
} from '../../../../lib/rate-limit';
import type { UserRow } from '@/lib/types';

export async function POST(req: NextRequest) {
  const isForm = isFormRequest(req);
  const contentType = req.headers.get('content-type') || '';
  const email = contentType.includes('application/json')
    ? normalizeEmail(((await req.json()) as { email?: string }).email || '')
    : normalizeEmail(String((await req.formData()).get('email') || ''));
  const emailLimit = checkRateLimit(rateLimitKey(['resend-verification', 'email', email || 'missing']), RESEND_EMAIL_RATE_LIMIT);
  if (!emailLimit.allowed) {
    return rateLimitResponse(emailLimit);
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  if (user && !user.email_confirmed_at) {
    const verification = createEmailVerificationToken(db, user.id);
    await sendVerificationEmail({ to: user.email, token: verification.token });
  }

  if (isForm) {
    return redirectToApp(req, '/login?verification=resent', { status: 303 });
  }

  return NextResponse.json({
    ok: true,
    message: 'If that account needs verification, a new confirmation email has been sent.',
  });
}
