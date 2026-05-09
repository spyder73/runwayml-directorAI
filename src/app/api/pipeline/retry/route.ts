import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { generateImagesPhase, generateVideoAudioPhase } from '@/lib/pipeline_final';
import { broadcastSessionUpdate } from '@/lib/sse';
import type { SceneRow } from '@/lib/types';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json() as { sessionId?: string };
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const scenes = db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
    if (scenes.length === 0) {
      return NextResponse.json({ error: 'No scenes to retry' }, { status: 400 });
    }

    const needsImages = scenes.some((scene) => !scene.reference_image_url || scene.status === 'generating_image' || scene.status === 'failed');
    const nextStatus = needsImages ? 'GENERATING_IMAGES' : 'GENERATING_FINAL_ASSETS';

    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextStatus, sessionId);
    db.prepare('UPDATE scenes SET status = ? WHERE session_id = ? AND status = ?')
      .run('pending', sessionId, 'failed');
    broadcastSessionUpdate(sessionId, {
      status: nextStatus,
      scenes: db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[],
    });

    if (needsImages) {
      generateImagesPhase(sessionId).catch(console.error);
    } else {
      generateVideoAudioPhase(sessionId).catch(console.error);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Retry API Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to retry generation' }, { status: 500 });
  }
}
