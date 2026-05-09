import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import db from '@/lib/db';
import { processInterviewTurn } from '@/lib/pipeline';
import type { SessionRow } from '@/lib/types';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

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
    const visionDescriptions: string[] = [];

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
         visionDescriptions.push(text);
      } catch (e) {
         console.error('Vision inference failed:', e);
      }

      db.prepare('INSERT INTO user_uploads (id, session_id, file_path, vision_description) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), sessionId, filePath, visionDescription);
        
      uploadedPaths.push(filePath);
    }

    if (uploadedPaths.length > 0) {
       const userMsg = uploadedPaths.map((p, i) => {
         let msg = `[Image: ${p}]`;
         if (visionDescriptions[i]) {
            msg += `\n*Vision Analysis: ${visionDescriptions[i]}*`;
         }
         return msg;
       }).join('\n\n');

       db.prepare('INSERT INTO chat_history (id, session_id, role, content) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), sessionId, 'user', `*User uploaded ${uploadedPaths.length} photo(s)*\n\n${userMsg}`);
        
       if (session.status === 'AWAITING_SELFIE') {
           db.prepare('UPDATE sessions SET user_selfie_url = ? WHERE id = ?').run(uploadedPaths[0], sessionId);
       } else if (session.status === 'PRE_PRODUCTION') {
           // just log it
       }
       
       processInterviewTurn(sessionId).catch(console.error);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Upload Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
