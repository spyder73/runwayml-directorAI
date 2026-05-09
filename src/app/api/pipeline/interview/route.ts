import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { processInterviewTurn } from '@/lib/pipeline';

export async function POST(req: NextRequest) {
  try {
    const { sessionId, message } = await req.json() as { sessionId?: string; message?: string };

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    // Save user message
    if (message) {
        db.prepare('INSERT INTO chat_history (id, session_id, role, content) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), sessionId, 'user', message);
    }
    
    // Process asynchronously so we don't block the UI
    processInterviewTurn(sessionId).catch(console.error);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
