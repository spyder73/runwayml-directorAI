import { NextRequest, NextResponse } from 'next/server';
import db from '../../../lib/db';
import { AUTH_SESSION_COOKIE, findAuthSessionByToken, readSessionTokenFromCookieHeader } from '../../../lib/auth/session';
import {
  getUserSettings,
  InvalidFinalRenderBackendError,
  InvalidRunwayConcurrencyModeError,
  InvalidRunwayVideoModelError,
  updateUserSettings,
  type UpdateUserSettingsInput,
} from '../../../lib/user-settings';

function readSessionToken(req: NextRequest) {
  return req.cookies?.get(AUTH_SESSION_COOKIE)?.value || readSessionTokenFromCookieHeader(req.headers.get('cookie'));
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function currentConfirmedUserId(req: NextRequest) {
  const auth = findAuthSessionByToken(db, readSessionToken(req));
  if (!auth) return { error: jsonError('Authentication required.', 401) };
  if (!auth.user.email_confirmed_at) return { error: jsonError('Confirm your email before updating settings.', 403) };
  return { userId: auth.user.id };
}

async function readSettingsPayload(req: NextRequest): Promise<UpdateUserSettingsInput> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body as UpdateUserSettingsInput : {};
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const auth = currentConfirmedUserId(req);
  if ('error' in auth) return auth.error;

  return NextResponse.json(getUserSettings(db, auth.userId));
}

export async function PUT(req: NextRequest) {
  const auth = currentConfirmedUserId(req);
  if ('error' in auth) return auth.error;

  try {
    return NextResponse.json(updateUserSettings(db, auth.userId, await readSettingsPayload(req)));
  } catch (error) {
    if (error instanceof InvalidRunwayConcurrencyModeError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof InvalidRunwayVideoModelError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof InvalidFinalRenderBackendError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof Error && error.message.includes('CREDENTIAL_ENCRYPTION_KEY')) {
      return jsonError('Credential encryption is not configured.', 500);
    }

    return jsonError('Unable to update settings right now.', 500);
  }
}
