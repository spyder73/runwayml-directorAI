import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { authGuardResponse, requireOwnedSessionForRequest } from '@/lib/auth/guards';
import { runAutomaticProductionPipeline } from '@/lib/pipeline_media';
import { GENERATION_RATE_LIMIT, checkRateLimit, rateLimitKey, rateLimitResponse } from '@/lib/rate-limit';
import { broadcastSessionUpdate } from '@/lib/sse';
import {
  getActiveReferenceRequest,
  loadStoryBucket,
  lockSceneOutlineForProduction,
  reviseSceneOutline,
} from '@/lib/story-bucket';
import type { ChatHistoryRow, SceneRow, SessionRow } from '@/lib/types';

function fullSessionUpdate(sessionId: string) {
  return {
    session: db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow,
    chat_history: db.prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatHistoryRow[],
    scenes: db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[],
    story_bucket: loadStoryBucket(db, sessionId),
    active_reference_request: getActiveReferenceRequest(db, sessionId) || null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sessionId?: string;
      action?: 'comment' | 'revise' | 'lock';
      sceneOutlineId?: string;
      sceneIndex?: number;
      comment?: string;
      updates?: Parameters<typeof reviseSceneOutline>[2]['updates'];
    };

    if (!body.sessionId || !body.action) {
      return NextResponse.json({ error: 'Missing input' }, { status: 400 });
    }

    const { auth } = requireOwnedSessionForRequest(req, body.sessionId);

    if (body.action === 'lock') {
      const generationLimit = checkRateLimit(rateLimitKey(['generation', 'outline-lock', auth.user.id]), GENERATION_RATE_LIMIT);
      if (!generationLimit.allowed) {
        return rateLimitResponse(generationLimit);
      }

      lockSceneOutlineForProduction(db, body.sessionId);
      const update = fullSessionUpdate(body.sessionId);
      broadcastSessionUpdate(body.sessionId, update);
      runAutomaticProductionPipeline(body.sessionId).catch(console.error);
      return NextResponse.json({ success: true, ...update });
    }

    if (body.action === 'comment' || body.action === 'revise') {
      const scene = reviseSceneOutline(db, body.sessionId, {
        sceneOutlineId: body.sceneOutlineId,
        sceneIndex: body.sceneIndex,
        comment: body.comment,
        updates: body.updates,
      });

      broadcastSessionUpdate(body.sessionId, fullSessionUpdate(body.sessionId));
      return NextResponse.json({ success: true, scene });
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
