import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

function createProductionDb() {
  const { initializeDatabaseSchema } = jiti('../src/lib/db.ts');
  const db = new Database(':memory:');
  initializeDatabaseSchema(db);
  return db;
}

function insertUser(db, userId = 'user-1') {
  db.prepare(`
    INSERT INTO users (id, email, password_hash, email_confirmed_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(userId, `${userId}@example.com`, 'hash');
  return userId;
}

function insertSession(db, sessionId = 'session-1', userId = 'user-1') {
  db.prepare(`
    INSERT INTO sessions (id, user_id, status, story_text, aspect_ratio, mode)
    VALUES (?, ?, 'PREVIEW_READY', '', '16:9', 'life_story')
  `).run(sessionId, userId);
  return sessionId;
}

async function withMediaStorageDir(fn) {
  const previous = process.env.MEDIA_STORAGE_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase7-media-'));
  process.env.MEDIA_STORAGE_DIR = directory;

  try {
    await fn(directory);
  } finally {
    if (previous === undefined) {
      delete process.env.MEDIA_STORAGE_DIR;
    } else {
      process.env.MEDIA_STORAGE_DIR = previous;
    }
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

async function writePrivateFile(file) {
  await fsp.mkdir(path.dirname(file.absolutePath), { recursive: true });
  await fsp.writeFile(file.absolutePath, '0123456789');
}

test('Phase 7 media helpers create private owned media assets and reject path traversal', async () => {
  await withMediaStorageDir(async (mediaDir) => {
    const db = createProductionDb();
    insertUser(db);
    insertSession(db);

    const {
      createMediaAssetForSession,
      createPrivateMediaFilePath,
      getOwnedMediaAsset,
      mediaAssetUrl,
      resolveMediaAssetPath,
    } = jiti('../src/lib/media-assets.ts');

    const file = createPrivateMediaFilePath({
      scope: 'generated',
      kind: 'image',
      sessionId: 'session-1',
      id: 'image-asset',
      extension: 'jpg',
    });
    await writePrivateFile(file);

    const asset = createMediaAssetForSession(db, {
      id: 'image-asset',
      sessionId: 'session-1',
      kind: 'image',
      filePath: file.relativePath,
      mimeType: 'image/jpeg',
      byteSize: 10,
      originalName: null,
    });

    assert.equal(file.relativePath, 'generated/image/session-1/image-asset.jpg');
    assert.equal(file.absolutePath, path.join(mediaDir, file.relativePath));
    assert.equal(asset.user_id, 'user-1');
    assert.equal(asset.session_id, 'session-1');
    assert.equal(asset.file_path, file.relativePath);
    assert.equal(mediaAssetUrl(asset.id), '/api/media/image-asset');
    assert.equal(resolveMediaAssetPath(asset), file.absolutePath);
    assert.equal(getOwnedMediaAsset(db, 'image-asset', 'user-1')?.id, 'image-asset');
    assert.equal(getOwnedMediaAsset(db, 'image-asset', 'stranger'), null);
    assert.throws(
      () => resolveMediaAssetPath({ ...asset, file_path: '../outside.jpg' }),
      /Invalid media asset path/,
    );
  });
});

test('Phase 7 media response serves full files and byte ranges with private cache headers', async () => {
  await withMediaStorageDir(async () => {
    const {
      createMediaFileResponse,
      createPrivateMediaFilePath,
    } = jiti('../src/lib/media-assets.ts');
    const file = createPrivateMediaFilePath({
      scope: 'generated',
      kind: 'video',
      sessionId: 'session-1',
      id: 'video-asset',
      extension: 'mp4',
    });
    await writePrivateFile(file);
    const asset = {
      id: 'video-asset',
      file_path: file.relativePath,
      mime_type: 'video/mp4',
    };

    const full = await createMediaFileResponse(asset, new Headers());
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('cache-control'), 'private, no-store');
    assert.equal(Buffer.from(await full.arrayBuffer()).toString(), '0123456789');

    const partial = await createMediaFileResponse(asset, new Headers({ range: 'bytes=2-5' }));
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(partial.headers.get('content-length'), '4');
    assert.equal(Buffer.from(await partial.arrayBuffer()).toString(), '2345');
  });
});

test('Runway persistence writes generated assets outside public and returns media API URLs', async () => {
  await withMediaStorageDir(async (mediaDir) => {
    const db = createProductionDb();
    insertUser(db);
    insertSession(db);
    const { persistGeneratedAsset } = jiti('../src/lib/runway.ts');
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(Buffer.from('private-image'), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });

    try {
      const asset = await persistGeneratedAsset(
        'https://runway.example/output.jpg',
        'image',
        'session-1',
        {},
        db,
      );

      const row = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(asset.mediaAssetId);
      assert.match(asset.localUrl, /^\/api\/media\//);
      assert.equal(row.user_id, 'user-1');
      assert.equal(row.session_id, 'session-1');
      assert.equal(row.kind, 'image');
      assert.equal(row.mime_type, 'image/jpeg');
      assert.equal(row.byte_size, Buffer.byteLength('private-image'));
      assert.match(row.file_path, /^generated\/image\/session-1\/.+\.jpg$/);
      assert.equal(fs.existsSync(path.join(mediaDir, row.file_path)), true);
      assert.equal(path.join(mediaDir, row.file_path).includes(`${path.sep}public${path.sep}`), false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('Narration duration probing resolves generated audio from private media storage', async () => {
  await withMediaStorageDir(async (mediaDir) => {
    const db = createProductionDb();
    insertUser(db);
    insertSession(db);
    const {
      createMediaAssetForSession,
      createPrivateMediaFilePath,
      mediaAssetUrl,
    } = jiti('../src/lib/media-assets.ts');
    const { resolveGeneratedAssetFilePath } = jiti('../src/lib/pipeline_media.ts');

    const audioFile = createPrivateMediaFilePath({
      scope: 'generated',
      kind: 'audio',
      sessionId: 'session-1',
      id: 'audio-asset',
      extension: 'mp3',
    });
    await writePrivateFile(audioFile);
    const audioAsset = createMediaAssetForSession(db, {
      id: 'audio-asset',
      sessionId: 'session-1',
      kind: 'audio',
      filePath: audioFile.relativePath,
      mimeType: 'audio/mpeg',
      byteSize: 10,
      originalName: null,
    });

    const resolved = resolveGeneratedAssetFilePath(db, 'session-1', {
      localUrl: mediaAssetUrl(audioAsset.id),
      filePath: audioAsset.file_path,
    });

    assert.equal(resolved, path.join(mediaDir, audioFile.relativePath));
    assert.equal(resolved.includes(`${path.sep}public${path.sep}`), false);
  });
});

test('Runway video uploads media API prompt images with a real filename extension', async () => {
  await withMediaStorageDir(async () => {
    const db = createProductionDb();
    insertUser(db);
    insertSession(db);
    const {
      createMediaAssetForSession,
      createPrivateMediaFilePath,
      mediaAssetUrl,
    } = jiti('../src/lib/media-assets.ts');
    const { generateVideoAsset } = jiti('../src/lib/runway.ts');
    const imageFile = createPrivateMediaFilePath({
      scope: 'generated',
      kind: 'image',
      sessionId: 'session-1',
      id: 'aba22b75-f36e-4a71-9187-30d0882e28e6',
      extension: 'jpg',
    });
    await writePrivateFile(imageFile);
    const imageAsset = createMediaAssetForSession(db, {
      id: 'aba22b75-f36e-4a71-9187-30d0882e28e6',
      sessionId: 'session-1',
      kind: 'image',
      filePath: imageFile.relativePath,
      mimeType: 'image/jpeg',
      byteSize: 10,
      originalName: null,
    });
    let uploadedFileName = '';
    let uploadedFileType = '';
    const runwayClient = {
      uploads: {
        createEphemeral: async ({ file }) => {
          uploadedFileName = file.name;
          uploadedFileType = file.type;
          return { uri: 'runway://uploaded-frame' };
        },
      },
      imageToVideo: {
        create: async (body) => {
          assert.equal(body.promptImage[0].uri, 'runway://uploaded-frame');
          return {
            id: 'video-task-1',
            waitForTaskOutput: async () => ({ output: ['https://runway.example/video.mp4'] }),
          };
        },
      },
    };
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(Buffer.from('private-video'), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });

    try {
      await generateVideoAsset({
        promptImageUrl: mediaAssetUrl(imageAsset.id),
        promptText: 'The camera slowly drifts toward the festival lights.',
        ratio: '1280:720',
        duration: 5,
        sessionId: 'session-1',
        runwayClient,
        database: db,
      });
    } finally {
      globalThis.fetch = previousFetch;
    }

    assert.match(uploadedFileName, /\.jpg$/);
    assert.equal(uploadedFileType, 'image/jpeg');
  });
});

test('Final render plan resolves media API URLs to local Remotion-readable file URLs', async () => {
  await withMediaStorageDir(async (mediaDir) => {
    const db = createProductionDb();
    insertUser(db);
    insertSession(db);
    const {
      createMediaAssetForSession,
      createPrivateMediaFilePath,
      mediaAssetUrl,
    } = jiti('../src/lib/media-assets.ts');
    const { buildFinalRenderPlan } = jiti('../src/lib/final-render.ts');

    const videoFile = createPrivateMediaFilePath({
      scope: 'generated',
      kind: 'video',
      sessionId: 'session-1',
      id: 'video-asset',
      extension: 'mp4',
    });
    const audioFile = createPrivateMediaFilePath({
      scope: 'generated',
      kind: 'audio',
      sessionId: 'session-1',
      id: 'audio-asset',
      extension: 'mp3',
    });
    await writePrivateFile(videoFile);
    await writePrivateFile(audioFile);
    const video = createMediaAssetForSession(db, {
      id: 'video-asset',
      sessionId: 'session-1',
      kind: 'video',
      filePath: videoFile.relativePath,
      mimeType: 'video/mp4',
      byteSize: 10,
      originalName: null,
    });
    const audio = createMediaAssetForSession(db, {
      id: 'audio-asset',
      sessionId: 'session-1',
      kind: 'audio',
      filePath: audioFile.relativePath,
      mimeType: 'audio/mpeg',
      byteSize: 10,
      originalName: null,
    });

    const plan = buildFinalRenderPlan({
      sessionId: 'session-1',
      aspectRatio: '16:9',
      database: db,
      scenes: [{
        id: 'scene-1',
        scene_index: 0,
        narrator_text: 'A private render.',
        video_url: JSON.stringify([mediaAssetUrl(video.id)]),
        shot_plan_json: JSON.stringify([{ duration: 3 }]),
        audio_url: mediaAssetUrl(audio.id),
        duration: 3,
      }],
    });

    assert.match(plan.publicUrl, /^\/api\/media\//);
    assert.equal(plan.outputFilePath.startsWith(path.join(mediaDir, 'generated', 'final', 'session-1')), true);
    assert.equal(plan.videoInputs[0].filePath, videoFile.absolutePath);
    assert.equal(plan.audioInputs[0].filePath, audioFile.absolutePath);
    assert.equal(plan.remotionInputProps.scenes[0].clips[0].url, pathToFileURL(videoFile.absolutePath).href);
    assert.equal(plan.remotionInputProps.scenes[0].audio_url, pathToFileURL(audioFile.absolutePath).href);
  });
});

test('Phase 7 routes and upload path are wired for authenticated private media', () => {
  const uploadSource = fs.readFileSync(new URL('../src/app/api/pipeline/upload/route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(uploadSource, /public['"],\s*['"]uploads|public\/uploads/);
  assert.match(uploadSource, /createUploadedMediaAssetForSession|createMediaAssetForSession/);
  assert.match(uploadSource, /mediaAssetUrl/);

  const routeSource = fs.readFileSync(new URL('../src/app/api/media/[id]/route.ts', import.meta.url), 'utf8');
  assert.match(routeSource, /requireCurrentUser/);
  assert.match(routeSource, /getOwnedMediaAsset/);
  assert.match(routeSource, /createMediaFileResponse/);
  assert.match(routeSource, /params:\s*Promise<\{\s*id:\s*string\s*\}>/);

  const mediaPipelineSource = fs.readFileSync(new URL('../src/lib/pipeline_media.ts', import.meta.url), 'utf8');
  const finalPipelineSource = fs.readFileSync(new URL('../src/lib/pipeline_final.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(mediaPipelineSource, /public['"],\s*audioAsset\.filePath/);
  assert.doesNotMatch(finalPipelineSource, /public['"],\s*audioAsset\.filePath/);
  assert.match(mediaPipelineSource, /resolveGeneratedAssetFilePath/);
  assert.match(finalPipelineSource, /resolveMediaUrlToFilePath/);
});
