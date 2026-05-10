import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { authGuardResponse, requireOwnedSessionForRequest } from '@/lib/auth/guards';
import { broadcastSessionUpdate } from '@/lib/sse';
import { getActiveReferenceRequest, loadStoryBucket, saveSketchFeedback } from '@/lib/story-bucket';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sessionId?: string;
      candidateId?: string;
      feedback?: 'accepted' | 'rejected' | 'revised';
      note?: string;
    };

    if (!body.sessionId || !body.candidateId || !body.feedback) {
      return NextResponse.json({ error: 'Missing input' }, { status: 400 });
    }

    requireOwnedSessionForRequest(req, body.sessionId);

    const candidate = saveSketchFeedback(db, body.sessionId, {
      candidateId: body.candidateId,
      feedback: body.feedback,
      note: body.note,
    });

    broadcastSessionUpdate(body.sessionId, {
      story_bucket: loadStoryBucket(db, body.sessionId),
      active_reference_request: getActiveReferenceRequest(db, body.sessionId) || null,
    });

    return NextResponse.json({ success: true, candidate });
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
