import { NextResponse } from 'next/server';
import { authGuardResponse, requireCurrentUser } from '@/lib/auth/guards';
import { getDemoReadinessReport } from '@/lib/demo-readiness';
import db from '@/lib/db';
import { getUserSettings } from '@/lib/user-settings';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const auth = requireCurrentUser(req);
    const settings = getUserSettings(db, auth.user.id);
    return NextResponse.json(await getDemoReadinessReport(process.env, {
      openrouterKeySaved: settings.openrouterKeySaved,
      runwayKeySaved: settings.runwayKeySaved,
    }));
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
