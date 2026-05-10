import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { authGuardResponse, requireOwnedSessionForRequest } from '@/lib/auth/guards';
import { startFinalRenderWithLock } from '@/lib/locks';
import { requeueMediaTasks } from '@/lib/media-tasks';
import { runFinalRenderPhase } from '@/lib/pipeline_media';
import { RENDER_RATE_LIMIT, checkRateLimit, rateLimitKey, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const { auth } = requireOwnedSessionForRequest(req, sessionId);
    const renderLimit = checkRateLimit(rateLimitKey(['render', 'start', auth.user.id]), RENDER_RATE_LIMIT);
    if (!renderLimit.allowed) {
      return rateLimitResponse(renderLimit);
    }

    const renderTask = db.prepare(`
      SELECT status FROM media_tasks
      WHERE session_id = ? AND kind = 'render_final'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sessionId) as { status: string } | undefined;

    if (renderTask?.status === 'running') {
      return NextResponse.json({ success: true, alreadyRunning: true });
    }

    const started = startFinalRenderWithLock(sessionId, () => {
      requeueMediaTasks(db, { sessionId, kind: 'render_final', clearOutput: true });
      return runFinalRenderPhase(sessionId);
    }, (error) => {
      console.error('Final render job failed:', error);
    });
    if (!started) {
      return NextResponse.json({ success: true, alreadyRunning: true });
    }

    return NextResponse.json({ success: true, alreadyRunning: false });
  } catch (error) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    console.error('Render API Error:', error);
    return NextResponse.json({ error: 'Failed to start render' }, { status: 500 });
  }
}
