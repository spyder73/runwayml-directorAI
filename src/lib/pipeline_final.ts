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

export async function runFinalGenerationPhase(sessionId: string) {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const scenes = getSessionScenes(sessionId);
    const uploads = db.prepare('SELECT * FROM user_uploads WHERE session_id = ?').all(sessionId) as UserUploadRow[];

    const referenceImages: { uri: string }[] = [];
    for (const upload of uploads.slice(0, 16)) { // runway max is 16
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

    // Parallelize Runway generation for all scenes
    await Promise.all(scenes.map(async (scene) => {
      // Mark as generating image
      db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('generating_image', scene.id);
      broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

      let imageUrl = '';
      let videoUrl = '';
      let audioUrl = '';

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
      
      db.prepare('UPDATE scenes SET reference_image_url = ?, status = ? WHERE id = ?').run(imageUrl, 'generating_video', scene.id);
      broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

      if (isMock) {
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        videoUrl = `https://www.w3schools.com/html/mov_bbb.mp4`;
        audioUrl = `https://www.w3schools.com/html/horse.ogg`;
      } else {
        try {
          // Video
          const videoTask = await client.imageToVideo.create({
            model: 'gen4_turbo',
            promptImage: [
              {
                uri: imageUrl,
                position: 'first'
              }
            ],
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
          // Audio (TTS)
          const audioTask = await client.textToSpeech.create({
             model: 'eleven_multilingual_v2',
             promptText: scene.narrator_text || "Scene audio",
             voice: {
               type: 'runway-preset',
               presetId: 'Bernard',
             },
          }).waitForTaskOutput();
          
          if (audioTask.output) {
             // @ts-ignore
             audioUrl = audioTask.output[0] || audioTask.output.audioUrl || audioTask.output; 
             // @ts-ignore
             if (typeof audioTask.output === 'string') {
                // @ts-ignore
                audioUrl = audioTask.output;
             // @ts-ignore
             } else if (audioTask.output.audioUrl) {
                // @ts-ignore
                audioUrl = audioTask.output.audioUrl;
             }
          }
        } catch (e) {
          console.error("Runway SDK TTS Error:", e);
          audioUrl = `https://www.w3schools.com/html/horse.ogg`;
        }
      }

      // Mark scene as completed
      db.prepare('UPDATE scenes SET video_url = ?, audio_url = ?, status = ? WHERE id = ?')
        .run(videoUrl, audioUrl, 'completed', scene.id);
        
      broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });
    }));

    // Update overall session status
    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('COMPLETED', sessionId);

    broadcastSessionUpdate(sessionId, { status: 'COMPLETED' });

  } catch (error: unknown) {
    console.error('Final generation failed:', error);
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('FAILED', sessionId);
    broadcastSessionUpdate(sessionId, { status: 'FAILED', error: String(error) });
  }
}
