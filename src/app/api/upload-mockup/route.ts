import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { createMediaAssetForSession, createPrivateMediaFilePath, mediaAssetUrl } from '@/lib/media-assets';

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

    const ext = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
    // Default to jpg when a remote URL has no obvious file extension.
    const finalExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    const privateFile = createPrivateMediaFilePath({
      scope: 'uploads',
      sessionId,
      id: uuidv4(),
      extension: finalExt,
    });

    // Save to disk
    await fs.mkdir(path.dirname(privateFile.absolutePath), { recursive: true });
    await fs.writeFile(privateFile.absolutePath, buffer);
    const mediaAsset = createMediaAssetForSession(db, {
      id: privateFile.id,
      sessionId,
      kind: 'upload',
      filePath: privateFile.relativePath,
      mimeType: response.headers.get('content-type') || 'image/jpeg',
      byteSize: buffer.byteLength,
      originalName: null,
    });
    const mediaUrl = mediaAssetUrl(mediaAsset.id);

    // Insert into user_uploads
    const id = uuidv4();
    db.prepare('INSERT INTO user_uploads (id, session_id, file_path) VALUES (?, ?, ?)').run(
      id, sessionId, mediaUrl
    );

    return NextResponse.json({ success: true, id, path: mediaUrl });
  } catch (error: unknown) {
    console.error('Error uploading mockup:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
  }
}
