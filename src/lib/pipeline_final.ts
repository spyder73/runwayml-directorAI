import db from './db';
import { broadcastSessionUpdate } from './sse';
import type { ReferenceAssetRow, SceneRow, SessionRow } from './types';
import { ensureSafePrompt } from './moderation';
import { getAudioDurationInSeconds } from 'get-audio-duration';
import path from 'path';
import { planShots } from './shot_planner';
import { parseReferenceAssetIds, prepareSceneReferences } from './production-references';
import { assertRunwayImagePrompt, assertRunwayVideoPrompt } from './prompt-lint';
import { FINAL_IMAGE_QUALITY } from './production-config';
import {
  completeMediaTasksForScenePhase,
  failMediaTasksForScenePhase,
} from './media-tasks';
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

function failScene(sessionId: string, sceneId: string, phase: 'image' | 'audio' | 'video', error: unknown) {
  failMediaTasksForScenePhase(db, {
    sessionId,
    sceneId,
    kind: phase === 'image' ? 'generate_scene_frame' : phase === 'audio' ? 'generate_narration' : 'generate_video_shot',
    error: formatError(error),
  });
  db.prepare(`
    UPDATE scenes
    SET status = ?,
        retry_attempts = COALESCE(retry_attempts, 0) + 1,
        last_failure = ?
    WHERE id = ?
  `).run(`${phase}_failed`, formatError(error), sceneId);
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

async function loadReferenceImages(assets: Array<Pick<ReferenceAssetRow, 'runway_uri' | 'local_url' | 'stable_tag'>>) {
  const referenceImages: RunwayReferenceImage[] = [];

  for (const asset of assets.slice(0, 16)) {
    try {
      if (asset.runway_uri) {
        referenceImages.push({ uri: asset.runway_uri, tag: asset.stable_tag });
      } else if (asset.local_url) {
        referenceImages.push(await loadReferenceImage(asset.local_url, asset.stable_tag));
      }
    } catch (error) {
      console.error(`Failed to load reference image ${asset.local_url || asset.runway_uri}:`, error);
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
    const scenesToGenerate = scenes.filter((scene) => (
      !scene.reference_image_url
      || scene.status === 'pending'
      || scene.status === 'generating_image'
      || scene.status === 'image_failed'
    ));
    const referenceAssets = db.prepare('SELECT * FROM reference_assets WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ReferenceAssetRow[];

    for (const scene of scenesToGenerate) {
      db.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?').run('generating_image', scene.id);
    }
    broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

    await mapWithConcurrency(scenesToGenerate, 3, async (scene) => {
      try {
        const preparedReferences = prepareSceneReferences({
          promptText: scene.image_prompt || scene.visual_prompt,
          sceneReferenceAssetIds: parseReferenceAssetIds(scene.scene_references),
          protagonistVisible: sceneShowsProtagonist(scene),
          assets: referenceAssets,
        });
        const promptText = await ensureSafePrompt(preparedReferences.promptText);
        assertRunwayImagePrompt({
          promptText,
          referenceImages: preparedReferences.referenceImages,
        });
        const referenceImages = await loadReferenceImages(preparedReferences.selectedAssets);
        const imageAsset = await generateImageAsset({
          promptText,
          quality: FINAL_IMAGE_QUALITY,
          ratio: imageRatio(session.aspect_ratio),
          referenceImages: referenceImages.length ? referenceImages : undefined,
          sessionId,
        });

        db.prepare('UPDATE scenes SET reference_image_url = ?, reference_tags = ?, status = ?, last_failure = NULL WHERE id = ?')
          .run(imageAsset.localUrl, JSON.stringify(preparedReferences.selectedAssets.map((asset) => asset.stable_tag)), 'awaiting_approval', scene.id);
        completeMediaTasksForScenePhase(db, {
          sessionId,
          sceneId: scene.id,
          kind: 'generate_scene_frame',
          outputAssetId: imageAsset.localUrl,
        });
        broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });
      } catch (error) {
        console.error('Runway SDK Image Error:', error);
        failScene(sessionId, scene.id, 'image', error);
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
    const scenesToGenerate = scenes.filter((scene) => (
      !scene.video_url
      || !scene.audio_url
      || scene.status === 'generating_video'
      || scene.status === 'generating_audio'
      || scene.status === 'audio_failed'
      || scene.status === 'video_failed'
    ));
    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('GENERATING_FINAL_ASSETS', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'GENERATING_FINAL_ASSETS', scenes });

    for (const scene of scenesToGenerate) {
      db.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?').run(scene.audio_url ? 'generating_video' : 'generating_audio', scene.id);
    }
    broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

    await mapWithConcurrency(scenesToGenerate, 2, async (scene) => {
      let activePhase: 'audio' | 'video' = scene.audio_url ? 'video' : 'audio';
      try {
        if (!scene.reference_image_url) {
          throw new Error(`Scene ${scene.scene_index + 1} is missing its generated reference image.`);
        }

        let exactDuration = scene.duration || 5;
        let audioUrl = scene.audio_url;

        if (!audioUrl || scene.status === 'audio_failed') {
          activePhase = 'audio';
          const audioAsset = await generateSpeechAsset({
            promptText: scene.narrator_text,
            sessionId,
          });
          audioUrl = audioAsset.localUrl;

          try {
            exactDuration = await getAudioDurationInSeconds(path.join(process.cwd(), 'public', audioAsset.filePath));
          } catch (error) {
            console.error('Could not get audio duration:', error);
          }

          db.prepare('UPDATE scenes SET audio_url = ?, duration = ?, status = ?, last_failure = NULL WHERE id = ?')
            .run(audioUrl, Math.ceil(exactDuration), 'audio_ready', scene.id);
          completeMediaTasksForScenePhase(db, {
            sessionId,
            sceneId: scene.id,
            kind: 'generate_narration',
            outputAssetId: audioUrl,
          });
          broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });
        }

        if (!scene.video_url || scene.status === 'video_failed') {
          activePhase = 'video';
          db.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?').run('generating_video', scene.id);
          broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

          const shots = await planShots(scene.video_prompt || scene.visual_prompt, exactDuration);
          const videoUrls: string[] = [];

          for (const shot of shots) {
            const safePrompt = await ensureSafePrompt(shot.prompt);
            assertRunwayVideoPrompt({
              promptText: safePrompt,
              durationSeconds: shot.duration,
            });
            const videoAsset = await generateVideoAsset({
              promptImageUrl: scene.reference_image_url,
              promptText: safePrompt,
              ratio: videoRatio(session.aspect_ratio),
              duration: shot.duration,
              sessionId,
            });
            videoUrls.push(videoAsset.localUrl);
          }

          const shotPlan = shots.map((shot, index) => ({
            ...shot,
            url: videoUrls[index],
          }));

          db.prepare('UPDATE scenes SET video_url = ?, shot_plan_json = ?, duration = ?, status = ?, last_failure = NULL WHERE id = ?')
            .run(JSON.stringify(videoUrls), JSON.stringify(shotPlan), Math.ceil(exactDuration), 'completed', scene.id);
          completeMediaTasksForScenePhase(db, {
            sessionId,
            sceneId: scene.id,
            kind: 'generate_video_shot',
            outputAssetId: JSON.stringify(videoUrls),
          });
        } else {
          db.prepare('UPDATE scenes SET status = ?, last_failure = NULL WHERE id = ?').run('completed', scene.id);
        }

        broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });
      } catch (error) {
        console.error('Runway SDK Video/Audio Error:', error);
        failScene(sessionId, scene.id, activePhase, error);
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
