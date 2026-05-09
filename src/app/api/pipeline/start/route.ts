import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import type { AspectRatio, ChatHistoryRow, SessionRow } from '@/lib/types';
import { createReferenceUploadRequest, getActiveReferenceRequest } from '@/lib/story-bucket';

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
    const firstMessage = mode === 'single_memory'
      ? 'Hello. I am the Director. You can add a protagonist reference now if you want yourself to appear more faithfully, or skip it. Tell me the memory you want to turn into a short film. What happened, and why does it still stay with you?'
      : 'Hello. I am the Director. You can add a protagonist reference now if you want yourself to appear more faithfully, or skip it. Let us start simply: what is your name and age?';
    db.prepare('INSERT INTO chat_history (id, session_id, role, content) VALUES (?, ?, ?, ?)')
      .run(msgId, sessionId, 'assistant', firstMessage);

    createReferenceUploadRequest(db, sessionId, {
      targetType: 'protagonist',
      targetLabel: 'you',
      promptText: 'Would you like to add a protagonist reference photo? It is completely optional.',
      reason: 'This helps keep you visually consistent if you appear in the film.',
      fallbackPrompt: 'No problem if you would rather not upload one. You can describe how you should appear instead.',
    }, { updateSessionStatus: false });

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
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
