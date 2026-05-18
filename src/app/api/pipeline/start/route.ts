import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { authGuardResponse, requireCurrentUser } from '@/lib/auth/guards';
import { GENERATION_RATE_LIMIT, checkRateLimit, rateLimitKey, rateLimitResponse } from '@/lib/rate-limit';
import type { AspectRatio, ChatHistoryRow, InterviewMedium, SessionRow } from '@/lib/types';
import { getActiveReferenceRequest } from '@/lib/story-bucket';

const FIRST_LIFE_STORY_MESSAGE = 'Hi, I am Nico Hale, your content director. I am 46, and I spent years turning half-remembered family stories into films over extremely bad coffee. We will keep this simple. To begin, what is your name, your age, what do you do, and where do you live now?';

export async function POST(req: NextRequest) {
  try {
    const auth = requireCurrentUser(req);
    const generationLimit = checkRateLimit(rateLimitKey(['generation', 'start', auth.user.id]), GENERATION_RATE_LIMIT);
    if (!generationLimit.allowed) {
      return rateLimitResponse(generationLimit);
    }

    const body = await req.json() as { aspectRatio?: AspectRatio; interviewMedium?: InterviewMedium };
    const aspectRatio = body.aspectRatio === '9:16' ? '9:16' : '16:9';
    const interviewMedium = body.interviewMedium === 'voice' ? 'voice' : 'text';

    const sessionId = uuidv4();

    db.prepare(`
      INSERT INTO sessions (
        id, user_id, status, story_text, aspect_ratio, mode, interview_medium, render_notification_email
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      auth.user.id,
      'INTERVIEW_ONBOARDING',
      '',
      aspectRatio,
      'life_story',
      interviewMedium,
      null,
    );

    const msgId = uuidv4();
    db.prepare('INSERT INTO chat_history (id, session_id, role, content) VALUES (?, ?, ?, ?)')
      .run(msgId, sessionId, 'assistant', FIRST_LIFE_STORY_MESSAGE);

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow;
    const history = db.prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatHistoryRow[];

    // Initial broadcast isn't really needed since the frontend will fetch or connect to SSE,
    // but good practice.
    // broadcastSessionUpdate(sessionId, { session, chat_history: history });

    return NextResponse.json({
      sessionId,
      session,
      chat_history: history,
      active_reference_request: getActiveReferenceRequest(db, sessionId) || null,
    });
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
