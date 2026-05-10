import { NextResponse } from 'next/server';
import { authGuardResponse, requireOwnedSessionForRequest } from '@/lib/auth/guards';
import { runFinalAssetsPhase } from '@/lib/pipeline_media';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    requireOwnedSessionForRequest(req, sessionId);

    runFinalAssetsPhase(sessionId).catch(console.error);

    return NextResponse.json({ success: true });
  } catch (error) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    console.error('Synthesize API Error:', error);
    return NextResponse.json({ error: 'Failed to start synthesis' }, { status: 500 });
  }
}
