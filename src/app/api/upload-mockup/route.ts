import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

export async function POST(req: Request) {
  try {
    const { sessionId, imageUrl } = await req.json();

    if (!sessionId || !imageUrl) {
      return NextResponse.json({ error: 'Missing sessionId or imageUrl' }, { status: 400 });
    }

    // Fetch the image from the URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create a filename and path
    const ext = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
    // Default to jpg when a remote URL has no obvious file extension.
    const finalExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    
    const filename = `${uuidv4()}.${finalExt}`;
    const relativePath = `uploads/${filename}`;
    const absolutePath = path.join(process.cwd(), 'public', relativePath);

    // Ensure uploads directory exists
    await fs.mkdir(path.join(process.cwd(), 'public', 'uploads'), { recursive: true });

    // Save to disk
    await fs.writeFile(absolutePath, buffer);

    // Insert into user_uploads
    const id = uuidv4();
    db.prepare('INSERT INTO user_uploads (id, session_id, file_path) VALUES (?, ?, ?)').run(
      id, sessionId, relativePath
    );

    return NextResponse.json({ success: true, id, path: relativePath });
  } catch (error: unknown) {
    console.error('Error uploading mockup:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
  }
}
