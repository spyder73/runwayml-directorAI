import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { authGuardResponse, requireOwnedSessionForRequest } from '@/lib/auth/guards';
import { notifyFinalRenderReady } from '@/lib/final-render-notification';
import { broadcastSessionUpdate } from '@/lib/sse';
import type { SessionRow } from '@/lib/types';

type RenderEmailRequest = {
  sessionId?: string;
  email?: string;
};

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as RenderEmailRequest;
    if (!body.sessionId) {
      return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });
    }

    const email = body.email?.trim().toLowerCase();
    if (!email || !isEmail(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    requireOwnedSessionForRequest(req, body.sessionId);
    db.prepare(`
      UPDATE sessions
      SET render_notification_email = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(email, body.sessionId);

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(body.sessionId) as SessionRow;
    if (session.status === 'COMPLETED' && session.final_video_url) {
      notifyFinalRenderReady(db, body.sessionId, session.final_video_url).catch((error) => {
        console.error('Failed to send final render email after address save', error);
      });
    }
    broadcastSessionUpdate(body.sessionId, { session });

    return NextResponse.json({ ok: true, render_notification_email: email });
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
