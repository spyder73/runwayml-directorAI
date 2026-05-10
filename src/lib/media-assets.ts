import type Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { MediaAssetRow, SessionRow } from './types';

type SqliteDatabase = Database.Database;

export type PrivateMediaScope = 'uploads' | 'generated';

export type PrivateMediaFile = {
  id: string;
  relativePath: string;
  absolutePath: string;
};

export function mediaStorageBaseDir() {
  return path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'data', 'media'));
}

function safePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}

function safeExtension(value: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned || 'bin';
}

function assertInsideMediaStorage(absolutePath: string) {
  const base = mediaStorageBaseDir();
  const resolved = path.resolve(absolutePath);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error('Invalid media asset path.');
  }
  return resolved;
}

export function createPrivateMediaFilePath(input: {
  scope: PrivateMediaScope;
  kind?: string;
  sessionId: string;
  id?: string;
  extension: string;
}): PrivateMediaFile {
  const id = safePathSegment(input.id || uuidv4());
  const sessionId = safePathSegment(input.sessionId);
  const extension = safeExtension(input.extension);
  const parts = input.scope === 'uploads'
    ? ['uploads', sessionId, `${id}.${extension}`]
    : ['generated', safePathSegment(input.kind || 'asset'), sessionId, `${id}.${extension}`];
  const relativePath = path.join(...parts);
  const absolutePath = assertInsideMediaStorage(path.join(mediaStorageBaseDir(), relativePath));

  return {
    id,
    relativePath,
    absolutePath,
  };
}

export function mediaAssetUrl(mediaAssetId: string) {
  return `/api/media/${encodeURIComponent(mediaAssetId)}`;
}

export function mediaAssetIdFromUrl(url: string) {
  const match = url.match(/^\/api\/media\/([^/?#]+)(?:[?#].*)?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function resolveMediaAssetPath(asset: Pick<MediaAssetRow, 'file_path'> | { file_path: string }) {
  const filePath = asset.file_path;
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(mediaStorageBaseDir(), filePath);
  return assertInsideMediaStorage(absolutePath);
}

function relativeMediaAssetPath(filePath: string) {
  const absolutePath = assertInsideMediaStorage(path.isAbsolute(filePath) ? filePath : path.join(mediaStorageBaseDir(), filePath));
  const relativePath = path.relative(mediaStorageBaseDir(), absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid media asset path.');
  }
  return relativePath;
}

function requireSessionOwner(database: SqliteDatabase, sessionId: string) {
  const session = database.prepare('SELECT user_id FROM sessions WHERE id = ?').get(sessionId) as Pick<SessionRow, 'user_id'> | undefined;
  if (!session?.user_id) {
    throw new Error(`Session ${sessionId} has no media owner.`);
  }
  return session.user_id;
}

export function createMediaAssetForSession(database: SqliteDatabase, input: {
  id?: string;
  sessionId: string;
  kind: string;
  filePath: string;
  mimeType: string;
  byteSize?: number | null;
  originalName?: string | null;
}) {
  const id = input.id || uuidv4();
  const userId = requireSessionOwner(database, input.sessionId);
  const relativePath = relativeMediaAssetPath(input.filePath);

  database.prepare(`
    INSERT INTO media_assets (
      id, user_id, session_id, kind, file_path, mime_type, byte_size, original_name
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    input.sessionId,
    input.kind,
    relativePath,
    input.mimeType || 'application/octet-stream',
    input.byteSize ?? null,
    input.originalName ?? null,
  );

  return database.prepare('SELECT * FROM media_assets WHERE id = ?').get(id) as MediaAssetRow;
}

export function getMediaAsset(database: SqliteDatabase, mediaAssetId: string) {
  return database.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaAssetId) as MediaAssetRow | undefined;
}

export function getOwnedMediaAsset(database: SqliteDatabase, mediaAssetId: string, userId: string) {
  return database.prepare('SELECT * FROM media_assets WHERE id = ? AND user_id = ?').get(mediaAssetId, userId) as MediaAssetRow | undefined || null;
}

export function resolveMediaUrlToFilePath(database: SqliteDatabase, url: string, sessionId?: string) {
  const mediaAssetId = mediaAssetIdFromUrl(url);
  if (!mediaAssetId) return null;

  const asset = getMediaAsset(database, mediaAssetId);
  if (!asset) {
    throw new Error(`Media asset not found: ${mediaAssetId}`);
  }
  if (sessionId && asset.session_id !== sessionId) {
    throw new Error(`Media asset ${mediaAssetId} does not belong to this session.`);
  }

  return {
    asset,
    filePath: resolveMediaAssetPath(asset),
  };
}

function parseRange(rangeHeader: string | null, size: number) {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return 'invalid' as const;

  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return 'invalid' as const;

  let start: number;
  let end: number;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'invalid' as const;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return 'invalid' as const;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

export async function createMediaFileResponse(
  asset: Pick<MediaAssetRow, 'file_path' | 'mime_type'> | { file_path: string; mime_type: string },
  requestHeaders: Headers,
) {
  const filePath = resolveMediaAssetPath(asset);
  const stat = await fs.stat(filePath);
  const range = parseRange(requestHeaders.get('range'), stat.size);
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Type': asset.mime_type || 'application/octet-stream',
  });

  if (range === 'invalid') {
    headers.set('Content-Range', `bytes */${stat.size}`);
    return new Response(null, { status: 416, headers });
  }

  const buffer = await fs.readFile(filePath);
  if (range) {
    const chunk = buffer.subarray(range.start, range.end + 1);
    headers.set('Content-Length', String(chunk.length));
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
    return new Response(chunk, { status: 206, headers });
  }

  headers.set('Content-Length', String(stat.size));
  return new Response(buffer, { status: 200, headers });
}
