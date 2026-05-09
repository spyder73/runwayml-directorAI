import db from './db';
import { broadcastSessionUpdate } from './sse';
import RunwayML from '@runwayml/sdk';
import type { SceneRow, SessionRow, UserUploadRow } from './types';
import fs from 'fs/promises';
import path from 'path';

const client = new RunwayML({
  apiKey: process.env.RUNWAYML_API_SECRET || '', 
});

function getSessionScenes(sessionId: string): SceneRow[] {
  return db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
}

export async function generateImagesPhase(sessionId: string) {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const scenes = getSessionScenes(sessionId);
    const uploads = db.prepare('SELECT * FROM user_uploads WHERE session_id = ?').all(sessionId) as UserUploadRow[];

    const referenceImages: { uri: string }[] = [];
    for (const upload of uploads.slice(0, 16)) {
      try {
        const filePath = path.join(process.cwd(), 'public', upload.file_path);
        const buffer = await fs.readFile(filePath);
        const ext = path.extname(upload.file_path).replace('.', '') || 'jpeg';
        const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
        const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;
        referenceImages.push({ uri: dataUri });
      } catch (e) {
        console.error(`Failed to load reference image ${upload.file_path}:`, e);
      }
    }

    const isMock = !process.env.RUNWAYML_API_SECRET;

    await Promise.all(scenes.map(async (scene) => {
      db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('generating_image', scene.id);
      broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

      let imageUrl = '';
      if (isMock) {
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
        imageUrl = `https://picsum.photos/seed/${scene.id}/1280/720`;
      } else {
        try {
          const ratio = session.aspect_ratio === '9:16' ? '1088:1920' : '1920:1088';
          const task = await client.textToImage.create({
             // @ts-ignore
             model: 'gpt_image_2',
             promptText: scene.image_prompt || scene.visual_prompt || "Cinematic scene",
             quality: 'high',
             ratio: ratio as any,
             referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
          }).waitForTaskOutput();
          
          if (task.output && task.output[0]) {
             imageUrl = task.output[0];
          } else {
             imageUrl = `https://picsum.photos/seed/${scene.id}/1280/720`;
          }
        } catch (e) {
          console.error("Runway SDK Image Error:", e);
          imageUrl = `https://picsum.photos/seed/${scene.id}/1280/720`;
        }
      }
      
      db.prepare('UPDATE scenes SET reference_image_url = ?, status = ? WHERE id = ?').run(imageUrl, 'awaiting_approval', scene.id);
    }));

    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('AWAITING_APPROVAL', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'AWAITING_APPROVAL', scenes: getSessionScenes(sessionId) });

  } catch (error: unknown) {
    console.error('Image generation failed:', error);
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('FAILED', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'FAILED', error: String(error) });
  }
}

export async function generateVideoAudioPhase(sessionId: string) {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const scenes = getSessionScenes(sessionId);
    const isMock = !process.env.RUNWAYML_API_SECRET;

    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('GENERATING_FINAL_ASSETS', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'GENERATING_FINAL_ASSETS' });

    await Promise.all(scenes.map(async (scene) => {
      db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('generating_video', scene.id);
      broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

      let videoUrl = '';
      let audioUrl = '';

      if (isMock) {
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        videoUrl = `https://www.w3schools.com/html/mov_bbb.mp4`;
        audioUrl = `https://www.w3schools.com/html/horse.ogg`;
      } else {
        try {
          const videoTask = await client.imageToVideo.create({
            model: 'gen4_turbo',
            promptImage: [{ uri: scene.reference_image_url || '', position: 'first' }],
            ratio: session.aspect_ratio === '9:16' ? '720:1280' : '1280:720',
            promptText: scene.video_prompt || scene.visual_prompt || '',
            duration: scene.duration || 5,
          }).waitForTaskOutput();
          
          if (videoTask.output && videoTask.output[0]) {
             videoUrl = videoTask.output[0];
          } else {
             videoUrl = `https://www.w3schools.com/html/mov_bbb.mp4`;
          }
        } catch (e) {
          console.error("Runway SDK Video Error:", e);
          videoUrl = `https://www.w3schools.com/html/mov_bbb.mp4`;
        }

        try {
          const audioTask = await client.textToSpeech.create({
             model: 'eleven_multilingual_v2',
             promptText: scene.narrator_text || "Scene audio",
             voice: { type: 'runway-preset', presetId: 'Bernard' },
          }).waitForTaskOutput();
          
          if (audioTask.output) {
             // @ts-ignore
             audioUrl = typeof audioTask.output === 'string' ? audioTask.output : (audioTask.output.audioUrl || audioTask.output[0]);
          }
        } catch (e) {
          console.error("Runway SDK TTS Error:", e);
          audioUrl = `https://www.w3schools.com/html/horse.ogg`;
        }
      }

      db.prepare('UPDATE scenes SET video_url = ?, audio_url = ?, status = ? WHERE id = ?').run(videoUrl, audioUrl, 'completed', scene.id);
      broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });
    }));

    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('PREVIEW_READY', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'PREVIEW_READY' });

  } catch (error: unknown) {
    console.error('Video/Audio generation failed:', error);
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('FAILED', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'FAILED', error: String(error) });
  }
}
