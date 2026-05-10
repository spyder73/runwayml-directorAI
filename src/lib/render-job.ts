import db from './db';
import { broadcastSessionUpdate } from './sse';
import type { SceneRow, SessionRow } from './types';
import { renderFinalFilm, type FinalRenderProgress } from './final-render';
import { canRenderFinal } from './pipeline-guards';
import {
  completeMediaTaskForSessionKind,
  failMediaTaskForSessionKind,
  getRenderProgressForSession,
  updateRenderProgressForSession,
} from './media-tasks';

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getSession(sessionId: string) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
}

function getScenes(sessionId: string) {
  return db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
}

function broadcastRenderJobProgress(sessionId: string, status?: SessionRow['status'], error?: string) {
  broadcastSessionUpdate(sessionId, {
    session: getSession(sessionId),
    ...(status ? { status } : {}),
    scenes: getScenes(sessionId),
    render_progress: getRenderProgressForSession(db, sessionId),
    ...(error ? { error } : {}),
  });
}

function persistRenderProgress(sessionId: string, progress: FinalRenderProgress) {
  try {
    updateRenderProgressForSession(db, sessionId, {
      progress: progress.progress,
      message: progress.message,
      detail: {
        renderedFrames: progress.renderedFrames,
        encodedFrames: progress.encodedFrames,
        totalFrames: progress.totalFrames,
        stitchStage: progress.stitchStage,
      },
    });
    broadcastRenderJobProgress(sessionId, 'RENDERING');
  } catch (error) {
    console.error('Failed to persist render progress', error);
  }
}

function completeRenderProgress(sessionId: string) {
  const current = getRenderProgressForSession(db, sessionId);
  persistRenderProgress(sessionId, {
    progress: 1,
    message: 'Final video ready',
    renderedFrames: current?.renderedFrames ?? null,
    encodedFrames: current?.encodedFrames ?? null,
    totalFrames: current?.totalFrames ?? null,
    stitchStage: current?.stitchStage ?? null,
  });
}

export async function startFinalRenderJob(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  db.prepare('UPDATE sessions SET status = ?, final_video_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('RENDERING', sessionId);
  persistRenderProgress(sessionId, {
    progress: 0,
    message: 'Preparing final render',
    renderedFrames: null,
    encodedFrames: null,
    totalFrames: null,
    stitchStage: null,
  });

  try {
    const scenes = getScenes(sessionId);
    const renderGuard = canRenderFinal({
      scenes: scenes.map((scene) => ({
        videoUrl: scene.video_url,
      })),
    });
    if (!renderGuard.allowed) {
      throw new Error(`Final render is not ready: ${renderGuard.reasons.join('; ')}`);
    }

    const rendered = await renderFinalFilm({
      sessionId,
      aspectRatio: session.aspect_ratio,
      scenes,
      onProgress: (progress) => persistRenderProgress(sessionId, progress),
    });

    completeRenderProgress(sessionId);
    db.prepare('UPDATE sessions SET status = ?, final_video_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('COMPLETED', rendered.publicUrl, sessionId);
    completeMediaTaskForSessionKind(db, {
      sessionId,
      kind: 'render_final',
      outputAssetId: rendered.publicUrl,
    });
    broadcastRenderJobProgress(sessionId, 'COMPLETED');

    return rendered;
  } catch (error) {
    failMediaTaskForSessionKind(db, {
      sessionId,
      kind: 'render_final',
      error: formatError(error),
    });
    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('FAILED', sessionId);
    broadcastRenderJobProgress(sessionId, 'FAILED', formatError(error));
    throw error;
  }
}
