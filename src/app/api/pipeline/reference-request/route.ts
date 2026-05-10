import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { authGuardResponse, requireOwnedSessionForRequest } from '@/lib/auth/guards';
import { broadcastSessionUpdate } from '@/lib/sse';
import { getActiveReferenceRequest, loadStoryBucket, markActiveReferenceRequest } from '@/lib/story-bucket';
import type { ChatHistoryRow, SceneRow, SessionRow } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { sessionId?: string; status?: 'skipped' | 'described' };
    if (!body.sessionId || !body.status) {
      return NextResponse.json({ error: 'Missing input' }, { status: 400 });
    }

    requireOwnedSessionForRequest(req, body.sessionId);

    markActiveReferenceRequest(db, body.sessionId, body.status);

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(body.sessionId) as SessionRow | undefined;
    if (session?.status === 'AWAITING_SELFIE' || session?.status === 'AWAITING_REFERENCE') {
      db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('INTERVIEW_DYNAMIC', body.sessionId);
    }

    broadcastSessionUpdate(body.sessionId, {
      session: db.prepare('SELECT * FROM sessions WHERE id = ?').get(body.sessionId) as SessionRow,
      chat_history: db.prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(body.sessionId) as ChatHistoryRow[],
      scenes: db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(body.sessionId) as SceneRow[],
      story_bucket: loadStoryBucket(db, body.sessionId),
      active_reference_request: getActiveReferenceRequest(db, body.sessionId) || null,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
