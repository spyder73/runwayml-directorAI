import db from './db';
import { broadcastSessionUpdate } from './sse';
import type { SceneRow, SessionRow } from './types';
import { renderFinalFilm } from './final-render';
import { canRenderFinal } from './pipeline-guards';
import { completeMediaTaskForSessionKind, failMediaTaskForSessionKind } from './media-tasks';

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getSession(sessionId: string) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
}

function getScenes(sessionId: string) {
  return db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
}

export async function startFinalRenderJob(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  db.prepare('UPDATE sessions SET status = ?, final_video_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('RENDERING', sessionId);
  broadcastSessionUpdate(sessionId, {
    session: getSession(sessionId),
    status: 'RENDERING',
    scenes: getScenes(sessionId),
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
    });

    db.prepare('UPDATE sessions SET status = ?, final_video_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('COMPLETED', rendered.publicUrl, sessionId);
    completeMediaTaskForSessionKind(db, {
      sessionId,
      kind: 'render_final',
      outputAssetId: rendered.publicUrl,
    });
    broadcastSessionUpdate(sessionId, {
      session: getSession(sessionId),
      status: 'COMPLETED',
      scenes: getScenes(sessionId),
    });

    return rendered;
  } catch (error) {
    failMediaTaskForSessionKind(db, {
      sessionId,
      kind: 'render_final',
      error: formatError(error),
    });
    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('FAILED', sessionId);
    broadcastSessionUpdate(sessionId, {
      session: getSession(sessionId),
      status: 'FAILED',
      scenes: getScenes(sessionId),
      error: formatError(error),
    });
    throw error;
  }
}
