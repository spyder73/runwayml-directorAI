import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '../../../../lib/db';
import { createEmailVerificationToken } from '../../../../lib/auth/email-verification';
import { hashPassword } from '../../../../lib/auth/password';
import { isFormRequest, jsonError, normalizeEmail, readAuthPayload, redirectToApp } from '../../../../lib/auth/http';
import { sendVerificationEmail } from '../../../../lib/email/smtp';
import {
  REGISTER_IP_RATE_LIMIT,
  checkRateLimit,
  rateLimitKey,
  rateLimitResponse,
  requestIp,
} from '../../../../lib/rate-limit';

function errorReason(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

export async function POST(req: NextRequest) {
  const isForm = isFormRequest(req);
  const ipLimit = checkRateLimit(rateLimitKey(['register', 'ip', requestIp(req)]), REGISTER_IP_RATE_LIMIT);
  if (!ipLimit.allowed) {
    return rateLimitResponse(ipLimit);
  }

  try {
    const payload = await readAuthPayload(req);
    const email = normalizeEmail(payload.email);

    if (!email || !email.includes('@')) {
      return isForm ? redirectToApp(req, '/register?error=invalid-email', { status: 303 }) : jsonError('Enter a valid email address.', 400);
    }

    if (payload.password.length < 8) {
      return isForm ? redirectToApp(req, '/register?error=password', { status: 303 }) : jsonError('Password must be at least 8 characters.', 400);
    }

    const passwordHash = await hashPassword(payload.password);
    const userId = uuidv4();
    const createUser = db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed_at)
        VALUES (?, ?, ?, NULL)
      `).run(userId, email, passwordHash);
      db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);
      return createEmailVerificationToken(db, userId);
    });

    const verification = createUser();
    const emailResult = await sendVerificationEmail({ to: email, token: verification.token });

    if (isForm) {
      return redirectToApp(req, '/login?registered=1', { status: 303 });
    }

    return NextResponse.json({
      ok: true,
      message: 'Registration created. Check your email to confirm your account.',
      verificationEmailSent: emailResult.sent,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE') || message.includes('constraint')) {
      return isForm ? redirectToApp(req, '/register?error=exists', { status: 303 }) : jsonError('An account with that email already exists.', 409);
    }

    console.error('Registration failed.', { reason: errorReason(error) });
    return isForm ? redirectToApp(req, '/register?error=server', { status: 303 }) : jsonError('Unable to register right now.', 500);
  }
}
