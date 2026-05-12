import { NextResponse } from 'next/server';
import { authGuardResponse, requireOwnedSessionForRequest } from '@/lib/auth/guards';
import { runAutomaticProductionPipeline } from '@/lib/pipeline_media';
import { GENERATION_RATE_LIMIT, checkRateLimit, rateLimitKey, rateLimitResponse } from '@/lib/rate-limit';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const { auth } = requireOwnedSessionForRequest(req, sessionId);
    const generationLimit = checkRateLimit(rateLimitKey(['generation', 'synthesize', auth.user.id]), GENERATION_RATE_LIMIT);
    if (!generationLimit.allowed) {
      return rateLimitResponse(generationLimit);
    }

    runAutomaticProductionPipeline(sessionId).catch(console.error);

    return NextResponse.json({ success: true });
  } catch (error) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    console.error('Synthesize API Error:', error);
    return NextResponse.json({ error: 'Failed to start synthesis' }, { status: 500 });
  }
}
