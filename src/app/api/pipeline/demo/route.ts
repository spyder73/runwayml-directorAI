import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { authGuardResponse, requireCurrentUser } from '@/lib/auth/guards';
import { createDemoMemorySeed } from '@/lib/demo-seeds';
import { GENERATION_RATE_LIMIT, checkRateLimit, rateLimitKey, rateLimitResponse } from '@/lib/rate-limit';
import type { AspectRatio } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const auth = requireCurrentUser(req);
    const generationLimit = checkRateLimit(rateLimitKey(['generation', 'demo', auth.user.id]), GENERATION_RATE_LIMIT);
    if (!generationLimit.allowed) {
      return rateLimitResponse(generationLimit);
    }

    const body = await req.json().catch(() => ({})) as { aspectRatio?: AspectRatio };
    const aspectRatio = body.aspectRatio === '9:16' ? '9:16' : '16:9';
    const result = createDemoMemorySeed(db, { aspectRatio, userId: auth.user.id });

    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
    });
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
