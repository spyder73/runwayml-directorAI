import db from './db';
import { broadcastSessionUpdate } from './sse';
import type { SceneRow, SessionRow, UserUploadRow } from './types';
import { ensureSafePrompt } from './moderation';
import { getAudioDurationInSeconds } from 'get-audio-duration';
import path from 'path';
import { planShots } from './shot_planner';
import {
  generateImageAsset,
  generateSpeechAsset,
  generateVideoAsset,
  imageRatio,
  loadReferenceImage,
  videoRatio,
  type RunwayReferenceImage,
} from './runway';

function getSessionScenes(sessionId: string): SceneRow[] {
  return db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sceneShowsProtagonist(scene: SceneRow) {
  return scene.is_protagonist_visible === 1 || scene.is_protagonist_visible === true;
}

function failScene(sessionId: string, sceneId: string, error: unknown) {
  db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('failed', sceneId);
  broadcastSessionUpdate(sessionId, {
    status: 'FAILED',
    error: formatError(error),
    scenes: getSessionScenes(sessionId),
  });
}

function failSession(sessionId: string, error: unknown) {
  db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('FAILED', sessionId);
  broadcastSessionUpdate(sessionId, {
    status: 'FAILED',
    error: formatError(error),
    scenes: getSessionScenes(sessionId),
  });
}

async function loadReferenceImages(uploads: UserUploadRow[]) {
  const referenceImages: RunwayReferenceImage[] = [];

  for (const upload of uploads.slice(0, 16)) {
    try {
      referenceImages.push(await loadReferenceImage(upload.file_path));
    } catch (error) {
      console.error(`Failed to load reference image ${upload.file_path}:`, error);
    }
  }

  return referenceImages;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  let firstError: unknown;

  async function runWorker() {
    while (!firstError) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      const item = items[currentIndex];
      if (!item) return;

      try {
        await worker(item);
      } catch (error) {
        firstError = error;
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));

  if (firstError) {
    throw firstError;
  }
}

export async function generateImagesPhase(sessionId: string) {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const scenes = getSessionScenes(sessionId);
    const scenesToGenerate = scenes.filter((scene) => !scene.reference_image_url || scene.status === 'pending' || scene.status === 'generating_image' || scene.status === 'failed');
    const uploads = db.prepare('SELECT * FROM user_uploads WHERE session_id = ?').all(sessionId) as UserUploadRow[];
    const referenceImages = await loadReferenceImages(uploads);

    for (const scene of scenesToGenerate) {
      db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('generating_image', scene.id);
    }
    broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

    await mapWithConcurrency(scenesToGenerate, 3, async (scene) => {
      try {
        const promptText = await ensureSafePrompt(scene.image_prompt || scene.visual_prompt);
        const imageAsset = await generateImageAsset({
          promptText,
          quality: 'high',
          ratio: imageRatio(session.aspect_ratio),
          referenceImages: sceneShowsProtagonist(scene) ? referenceImages : undefined,
          sessionId,
        });

        db.prepare('UPDATE scenes SET reference_image_url = ?, status = ? WHERE id = ?')
          .run(imageAsset.localUrl, 'awaiting_approval', scene.id);
        broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });
      } catch (error) {
        console.error('Runway SDK Image Error:', error);
        failScene(sessionId, scene.id, error);
        throw error;
      }
    });

    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('GENERATING_FINAL_ASSETS', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'GENERATING_FINAL_ASSETS', scenes: getSessionScenes(sessionId) });

    generateVideoAudioPhase(sessionId).catch((error) => console.error('Final synthesis phase error:', error));
  } catch (error: unknown) {
    console.error('Image generation failed:', error);
    failSession(sessionId, error);
  }
}

export async function generateVideoAudioPhase(sessionId: string) {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const scenes = getSessionScenes(sessionId);
    const scenesToGenerate = scenes.filter((scene) => !scene.video_url || !scene.audio_url || scene.status === 'generating_video' || scene.status === 'failed');
    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('GENERATING_FINAL_ASSETS', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'GENERATING_FINAL_ASSETS', scenes });

    for (const scene of scenesToGenerate) {
      db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('generating_video', scene.id);
    }
    broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

    await mapWithConcurrency(scenesToGenerate, 2, async (scene) => {
      try {
        if (!scene.reference_image_url) {
          throw new Error(`Scene ${scene.scene_index + 1} is missing its generated reference image.`);
        }

        const audioAsset = await generateSpeechAsset({
          promptText: scene.narrator_text,
          sessionId,
        });

        let exactDuration = scene.duration || 5;
        try {
          exactDuration = await getAudioDurationInSeconds(path.join(process.cwd(), 'public', audioAsset.filePath));
        } catch (error) {
          console.error('Could not get audio duration:', error);
        }

        const shots = await planShots(scene.video_prompt || scene.visual_prompt, exactDuration);
        const videoUrls: string[] = [];

        for (const shot of shots) {
          const safePrompt = await ensureSafePrompt(shot.prompt);
          const videoAsset = await generateVideoAsset({
            promptImageUrl: scene.reference_image_url,
            promptText: safePrompt,
            ratio: videoRatio(session.aspect_ratio),
            duration: shot.duration,
            sessionId,
          });
          videoUrls.push(videoAsset.localUrl);
        }

        db.prepare('UPDATE scenes SET video_url = ?, audio_url = ?, duration = ?, status = ? WHERE id = ?')
          .run(JSON.stringify(videoUrls), audioAsset.localUrl, Math.ceil(exactDuration), 'completed', scene.id);
        broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });
      } catch (error) {
        console.error('Runway SDK Video/Audio Error:', error);
        failScene(sessionId, scene.id, error);
        throw error;
      }
    });

    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('PREVIEW_READY', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'PREVIEW_READY', scenes: getSessionScenes(sessionId) });
  } catch (error: unknown) {
    console.error('Video/Audio generation failed:', error);
    failSession(sessionId, error);
  }
}
