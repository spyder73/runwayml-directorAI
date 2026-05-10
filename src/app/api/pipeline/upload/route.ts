import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import db from '@/lib/db';
import { processInterviewTurn } from '@/lib/pipeline';
import type { ChatHistoryRow, SessionRow } from '@/lib/types';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { broadcastSessionUpdate } from '@/lib/sse';
import {
  createReferenceAsset,
  getActiveReferenceRequest,
  loadStoryBucket,
} from '@/lib/story-bucket';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MAX_VISION_DESCRIPTION_OUTPUT_TOKENS = 1024;

function nextStatusAfterUpload(session: SessionRow, activeRequest: ReturnType<typeof getActiveReferenceRequest>) {
  if (session.mode === 'life_story' && activeRequest?.target_type === 'protagonist' && activeRequest.reference_scope !== 'scene') {
    return 'INTERVIEW_PSYCH_PROFILE';
  }
  return 'INTERVIEW_DYNAMIC';
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const sessionId = formData.get('sessionId') as string;
    const files = formData.getAll('files') as File[];

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });

    const uploadedPaths: string[] = [];
    const activeRequest = getActiveReferenceRequest(db, sessionId);

    // Save files locally
    for (const file of files) {
      if (file.size === 0) continue;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `${uuidv4()}.${ext}`;
      const filePath = `/uploads/${fileName}`;

      await fs.writeFile(path.join(process.cwd(), 'public', filePath), buffer);

      // Vision inference
      let visionDescription = null;
      try {
         const mimeType = file.type || 'image/jpeg';
         const base64Data = buffer.toString('base64');
         const dataUri = `data:${mimeType};base64,${base64Data}`;
         
         const { text } = await generateText({
            model: openrouter('google/gemini-3.1-flash-lite'), // using gemini 3.1 flash lite for vision
            maxOutputTokens: MAX_VISION_DESCRIPTION_OUTPUT_TOKENS,
            messages: [
               {
                 role: 'user',
                 content: [
                    { type: 'text', text: 'Describe this image in detail so a film director can use it as a reference for a scene.' },
                    { type: 'image', image: dataUri }
                 ]
               }
            ]
         });
         visionDescription = text;
      } catch (e) {
         console.error('Vision inference failed:', e);
      }

      db.prepare('INSERT INTO user_uploads (id, session_id, file_path, vision_description) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), sessionId, filePath, visionDescription);

      const targetType = activeRequest?.target_type || (session.status === 'AWAITING_SELFIE' ? 'protagonist' : 'reference');
      const targetLabel = activeRequest?.target_label || (targetType === 'protagonist' ? 'protagonist' : 'reference');
      createReferenceAsset(db, sessionId, {
        localUrl: filePath,
        targetType,
        targetLabel,
        visionDescription,
        usagePermissions: 'allowed',
        source: 'upload',
      });
        
      uploadedPaths.push(filePath);
    }

    if (uploadedPaths.length > 0) {
       const userMsg = uploadedPaths.map((p) => `[Image: ${p}]`).join('\n\n');

       const messageId = uuidv4();
       db.prepare('INSERT INTO chat_history (id, session_id, role, content) VALUES (?, ?, ?, ?)')
        .run(messageId, sessionId, 'user', userMsg);
        
       if (session.status === 'AWAITING_SELFIE' || activeRequest?.target_type === 'protagonist') {
           db.prepare('UPDATE sessions SET user_selfie_url = ? WHERE id = ?').run(uploadedPaths[0], sessionId);
       }

       if (session.status === 'AWAITING_SELFIE' || session.status === 'AWAITING_REFERENCE') {
           db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextStatusAfterUpload(session, activeRequest), sessionId);
       }

       const updatedSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow;
       const chatHistory = db.prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatHistoryRow[];
       broadcastSessionUpdate(sessionId, {
         session: updatedSession,
         chat_history: chatHistory,
         story_bucket: loadStoryBucket(db, sessionId),
         active_reference_request: getActiveReferenceRequest(db, sessionId) || null,
       });
       
       processInterviewTurn(sessionId).catch(console.error);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Upload Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
