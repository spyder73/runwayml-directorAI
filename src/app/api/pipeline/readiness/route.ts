import { NextResponse } from 'next/server';
import { authGuardResponse, requireCurrentUser } from '@/lib/auth/guards';
import { getDemoReadinessReport } from '@/lib/demo-readiness';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    requireCurrentUser(req);
    return NextResponse.json(await getDemoReadinessReport());
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
