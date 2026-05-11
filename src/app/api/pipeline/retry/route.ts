import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { authGuardResponse, requireOwnedSessionForRequest } from '@/lib/auth/guards';
import { startFinalRenderWithLock } from '@/lib/locks';
import { runAutomaticProductionPipeline, runFinalRenderPhase } from '@/lib/pipeline_media';
import { GENERATION_RATE_LIMIT, RENDER_RATE_LIMIT, checkRateLimit, rateLimitKey, rateLimitResponse } from '@/lib/rate-limit';
import { broadcastSessionUpdate } from '@/lib/sse';
import { requeueMediaTasks, resetFailedMediaTasks, type MediaTaskKind } from '@/lib/media-tasks';
import type { SceneRow } from '@/lib/types';

type RetryUnit = 'image' | 'audio' | 'video' | 'render';

function currentRenderTaskStatus(sessionId: string) {
  return db.prepare(`
    SELECT status FROM media_tasks
    WHERE session_id = ? AND kind = 'render_final'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId) as { status: string } | undefined;
}

function startRenderRetry(sessionId: string) {
  const renderTask = currentRenderTaskStatus(sessionId);
  if (renderTask?.status === 'running') {
    return { started: false, alreadyRunning: true };
  }

  const started = startFinalRenderWithLock(sessionId, () => {
    requeueMediaTasks(db, { sessionId, kind: 'render_final', clearOutput: true });
    return runFinalRenderPhase(sessionId);
  }, (error) => {
    console.error('Final render retry failed:', error);
  });

  return { started, alreadyRunning: !started };
}

export async function POST(req: Request) {
  try {
    const { sessionId, unit, sceneId } = await req.json() as { sessionId?: string; unit?: RetryUnit; sceneId?: string };
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const { auth } = requireOwnedSessionForRequest(req, sessionId);
    const retryLimit = checkRateLimit(
      rateLimitKey([unit === 'render' ? 'render' : 'generation', 'retry', auth.user.id]),
      unit === 'render' ? RENDER_RATE_LIMIT : GENERATION_RATE_LIMIT,
    );
    if (!retryLimit.allowed) {
      return rateLimitResponse(retryLimit);
    }

    if (unit === 'render') {
      const { alreadyRunning } = startRenderRetry(sessionId);
      return NextResponse.json({ success: true, alreadyRunning });
    }

    const scenes = db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
    if (scenes.length === 0) {
      return NextResponse.json({ error: 'No scenes to retry' }, { status: 400 });
    }

    if (unit && sceneId) {
      if (unit === 'image') {
        resetFailedMediaTasks(db, { sessionId, sceneId, kind: 'generate_scene_frame' });
        db.prepare(`
          UPDATE scenes
          SET reference_image_url = NULL, status = 'pending', last_failure = NULL
          WHERE id = ? AND session_id = ?
        `).run(sceneId, sessionId);
      } else if (unit === 'audio') {
        resetFailedMediaTasks(db, { sessionId, sceneId, kind: 'generate_narration' });
        db.prepare(`
          UPDATE scenes
          SET audio_url = NULL, status = 'audio_failed', last_failure = NULL
          WHERE id = ? AND session_id = ?
        `).run(sceneId, sessionId);
      } else if (unit === 'video') {
        resetFailedMediaTasks(db, { sessionId, sceneId, kind: 'generate_video_shot' });
        db.prepare(`
          UPDATE scenes
          SET video_url = NULL, status = 'video_failed', last_failure = NULL
          WHERE id = ? AND session_id = ?
        `).run(sceneId, sessionId);
      }
    } else {
      ([
        'generate_scene_frame',
        'generate_narration',
        'generate_video_shot',
        'render_final',
      ] as MediaTaskKind[]).forEach((kind) => resetFailedMediaTasks(db, { sessionId, kind }));
      db.prepare(`
        UPDATE scenes
        SET status = CASE
              WHEN status IN ('image_failed', 'failed') AND reference_image_url IS NULL THEN 'pending'
              WHEN status = 'audio_failed' THEN 'audio_failed'
              WHEN status = 'video_failed' THEN 'video_failed'
              ELSE status
            END,
            last_failure = NULL
        WHERE session_id = ?
          AND status IN ('failed', 'image_failed', 'audio_failed', 'video_failed')
      `).run(sessionId);
    }

    const refreshedScenes = db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
    const needsImages = refreshedScenes.some((scene) => !scene.reference_image_url || scene.status === 'generating_image' || scene.status === 'image_failed' || scene.status === 'pending');
    const hasMediaFailures = refreshedScenes.some((scene) => scene.status === 'audio_failed' || scene.status === 'video_failed');

    if (!unit && !needsImages && !hasMediaFailures && refreshedScenes.every((scene) => scene.video_url)) {
      const { alreadyRunning } = startRenderRetry(sessionId);
      return NextResponse.json({ success: true, alreadyRunning });
    }

    const nextStatus = needsImages ? 'GENERATING_IMAGES' : 'GENERATING_FINAL_ASSETS';

    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextStatus, sessionId);
    broadcastSessionUpdate(sessionId, {
      status: nextStatus,
      scenes: db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[],
    });

    runAutomaticProductionPipeline(sessionId).catch(console.error);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    console.error('Retry API Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to retry generation' }, { status: 500 });
  }
}
