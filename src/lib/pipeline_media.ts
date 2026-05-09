import db from './db';
import { broadcastSessionUpdate } from './sse';
import type { SceneRow } from './types';

export async function runMediaGenerationPhase(sessionId: string) {
  try {
    const scenes = db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
    
    // Parallelize reference image generation
    await Promise.all(scenes.map(async (scene) => {
      // Mark as generating
      db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('generating_image', scene.id);
      
      // Mock generation delay
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
      
      const mockImageUrl = `https://picsum.photos/seed/${scene.id}/800/450`;
      
      db.prepare('UPDATE scenes SET reference_image_url = ?, status = ? WHERE id = ?')
        .run(mockImageUrl, 'image_generated', scene.id);
    }));

    // Re-fetch scenes once all promises resolve to ensure correct SSE state
    const updatedScenes = db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
    broadcastSessionUpdate(sessionId, { scenes: updatedScenes });

    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('AWAITING_APPROVAL', sessionId);

    broadcastSessionUpdate(sessionId, { status: 'AWAITING_APPROVAL' });

  } catch (error: unknown) {
    console.error('Media generation failed:', error);
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('FAILED', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'FAILED', error: String(error) });
  }
}
