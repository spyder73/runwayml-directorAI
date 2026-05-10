import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { requeueMediaTasks } from '@/lib/media-tasks';
import { runFinalRenderPhase } from '@/lib/pipeline_media';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const renderTask = db.prepare(`
      SELECT status FROM media_tasks
      WHERE session_id = ? AND kind = 'render_final'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sessionId) as { status: string } | undefined;

    if (renderTask?.status !== 'running') {
      requeueMediaTasks(db, { sessionId, kind: 'render_final', clearOutput: true });
    }

    runFinalRenderPhase(sessionId).catch((error) => {
      console.error('Final render job failed:', error);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Render API Error:', error);
    return NextResponse.json({ error: 'Failed to start render' }, { status: 500 });
  }
}
