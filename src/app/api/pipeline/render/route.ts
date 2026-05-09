import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { broadcastSessionUpdate } from '@/lib/sse';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('RENDERING', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'RENDERING' });

    // Mock an external render process taking 5 seconds
    setTimeout(() => {
        db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('COMPLETED', sessionId);
        broadcastSessionUpdate(sessionId, { status: 'COMPLETED' });
    }, 5000);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Render API Error:', error);
    return NextResponse.json({ error: 'Failed to start render' }, { status: 500 });
  }
}
