import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import type { AspectRatio, ChatHistoryRow, SessionRow } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { aspectRatio?: AspectRatio, mode?: string };
    const aspectRatio = body.aspectRatio === '9:16' ? '9:16' : '16:9';
    const mode = body.mode === 'single_memory' ? 'single_memory' : 'life_story';

    const sessionId = uuidv4();

    // Initialize session
    db.prepare('INSERT INTO sessions (id, status, story_text, aspect_ratio, mode) VALUES (?, ?, ?, ?, ?)')
      .run(sessionId, 'INTERVIEW_ONBOARDING', '', aspectRatio, mode);

    // Add first message from Director
    const msgId = uuidv4();
    db.prepare('INSERT INTO chat_history (id, session_id, role, content) VALUES (?, ?, ?, ?)')
      .run(msgId, sessionId, 'assistant', 'Hello. I am the Director. I want to help you turn your memories into a cinematic film. Let us start with the basics. What is your name?');

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow;
    const history = db.prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatHistoryRow[];

    // Initial broadcast isn't really needed since the frontend will fetch or connect to SSE,
    // but good practice.
    // broadcastSessionUpdate(sessionId, { session, chat_history: history });

    return NextResponse.json({ sessionId, session, chat_history: history });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
