#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import RunwayML from '@runwayml/sdk';

function usage() {
  return `Usage:
  node scripts/recover-runway-shot.mjs --session-id SESSION --scene-index 2 --shot-index 2 --runway-task-id TASK_ID
  node scripts/recover-runway-shot.mjs --session-id SESSION --scene-index 2 --shot-index 2 --media-asset-id MEDIA_ASSET_ID

Options:
  --session-id        LifeStory session id.
  --scene-id         Scene database id. Use this instead of --scene-index if you prefer.
  --scene-index      1-based scene number shown in the UI.
  --shot-index       1-based sub-scene number shown in the UI.
  --runway-task-id   Runway task id from media-generation logs.
  --output-url       Direct Runway output URL. If omitted, the script retrieves the task.
  --media-asset-id   Existing video media asset id to link without downloading.
  --local-url        Existing /api/media/... URL to link without downloading.
  --runway-api-key   Optional Runway API key. If omitted, decrypts the session owner's saved key.
  --db-path          Optional SQLite path. Defaults to LIFESTORY_DB_PATH or data/lifestory.sqlite.
  --media-dir        Optional media dir. Defaults to MEDIA_STORAGE_DIR or data/media.
  --dry-run          Print what would change without writing files or DB rows.
`;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      throw new Error(`Unexpected argument: ${item}`);
    }
    const key = item.slice(2);
    if (key === 'dry-run') {
      args[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function requireArg(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing --${key}`);
  }
  return value.trim();
}

function optionalPositiveIndex(args, key) {
  const value = args[key];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${key} must be a 1-based integer.`);
  }
  return parsed - 1;
}

function safePathSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}

function extensionFor(contentType, remoteUrl) {
  if (contentType?.includes('mp4')) return 'mp4';
  try {
    const ext = path.extname(new URL(remoteUrl).pathname).replace('.', '').toLowerCase();
    if (ext) return ext.replace(/[^a-z0-9]/g, '') || 'mp4';
  } catch {
    // Fall through to the default.
  }
  return 'mp4';
}

function mimeTypeFor(contentType) {
  return contentType?.trim() || 'video/mp4';
}

function mediaAssetUrl(mediaAssetId) {
  return `/api/media/${encodeURIComponent(mediaAssetId)}`;
}

function mediaAssetIdFromUrl(url) {
  const match = url.match(/^\/api\/media\/([^/?#]+)(?:[?#].*)?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function databasePath(args) {
  return args['db-path'] || process.env.LIFESTORY_DB_PATH || path.join(process.cwd(), 'data', 'lifestory.sqlite');
}

function mediaStorageBaseDir(args) {
  return path.resolve(args['media-dir'] || process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'data', 'media'));
}

function decryptCredential(envelope) {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is required to decrypt the saved Runway key. Pass --runway-api-key instead.');
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function readRunwayKey(database, sessionId, explicitKey) {
  if (explicitKey) return explicitKey;

  const session = database.prepare('SELECT id, user_id FROM sessions WHERE id = ?').get(sessionId);
  if (!session?.user_id) {
    throw new Error(`Session ${sessionId} has no user owner. Pass --runway-api-key.`);
  }

  const row = database.prepare(`
    SELECT runway_key_encrypted, runway_key_iv, runway_key_tag
    FROM user_api_credentials
    WHERE user_id = ?
  `).get(session.user_id);

  if (!row?.runway_key_encrypted || !row?.runway_key_iv || !row?.runway_key_tag) {
    throw new Error(`No saved Runway key found for session owner ${session.user_id}. Pass --runway-api-key.`);
  }

  return decryptCredential({
    encrypted: row.runway_key_encrypted,
    iv: row.runway_key_iv,
    tag: row.runway_key_tag,
  }).trim();
}

async function retrieveRunwayOutputUrl(args, database, sessionId) {
  if (args['output-url']) return args['output-url'];
  const taskId = requireArg(args, 'runway-task-id');
  const apiKey = readRunwayKey(database, sessionId, args['runway-api-key']);
  const client = new RunwayML({ apiKey });
  const task = await client.tasks.retrieve(taskId);

  if (task.status !== 'SUCCEEDED') {
    throw new Error(`Runway task ${taskId} is ${task.status}, not SUCCEEDED.`);
  }
  const outputUrl = Array.isArray(task.output) ? task.output[0] : undefined;
  if (!outputUrl || !/^https?:\/\//i.test(outputUrl)) {
    throw new Error(`Runway task ${taskId} has no usable output URL.`);
  }
  return outputUrl;
}

function localUrlFromExistingAsset(database, sessionId, args) {
  const explicitUrl = args['local-url'];
  const assetId = args['media-asset-id'] || (explicitUrl ? mediaAssetIdFromUrl(explicitUrl) : null);
  if (!assetId) return null;

  const asset = database.prepare('SELECT * FROM media_assets WHERE id = ? AND session_id = ?').get(assetId, sessionId);
  if (!asset) {
    throw new Error(`Media asset ${assetId} was not found in session ${sessionId}.`);
  }
  if (asset.kind !== 'video') {
    throw new Error(`Media asset ${assetId} is ${asset.kind}, not video.`);
  }

  return mediaAssetUrl(asset.id);
}

function readScene(database, sessionId, args) {
  const sceneId = args['scene-id'];
  if (sceneId) {
    const scene = database.prepare('SELECT * FROM scenes WHERE id = ? AND session_id = ?').get(sceneId, sessionId);
    if (!scene) throw new Error(`Scene ${sceneId} was not found in session ${sessionId}.`);
    return scene;
  }

  const sceneIndex = optionalPositiveIndex(args, 'scene-index');
  if (sceneIndex === undefined) throw new Error('Pass either --scene-id or --scene-index.');

  const scene = database.prepare('SELECT * FROM scenes WHERE session_id = ? AND scene_index = ?').get(sessionId, sceneIndex);
  if (!scene) throw new Error(`Scene ${sceneIndex + 1} was not found in session ${sessionId}.`);
  return scene;
}

function parseShotPlan(scene) {
  if (!scene.shot_plan_json) {
    throw new Error(`Scene ${scene.id} has no shot_plan_json yet.`);
  }
  const parsed = JSON.parse(scene.shot_plan_json);
  if (!Array.isArray(parsed)) {
    throw new Error(`Scene ${scene.id} shot_plan_json is not an array.`);
  }
  return parsed;
}

async function persistVideoAsset(database, args, sessionId, outputUrl) {
  const response = await fetch(outputUrl);
  if (!response.ok) {
    throw new Error(`Failed to download Runway output: ${response.status} ${response.statusText}`);
  }

  const session = database.prepare('SELECT id, user_id FROM sessions WHERE id = ?').get(sessionId);
  if (!session?.user_id) {
    throw new Error(`Session ${sessionId} has no media owner.`);
  }

  const contentType = response.headers.get('content-type');
  const extension = extensionFor(contentType, outputUrl);
  const id = crypto.randomUUID();
  const mediaDir = mediaStorageBaseDir(args);
  const relativePath = path.join('generated', 'video', safePathSegment(sessionId), `${id}.${extension}`);
  const absolutePath = path.join(mediaDir, relativePath);
  const buffer = Buffer.from(await response.arrayBuffer());

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  database.prepare(`
    INSERT INTO media_assets (
      id, user_id, session_id, kind, file_path, mime_type, byte_size, original_name
    )
    VALUES (?, ?, ?, 'video', ?, ?, ?, NULL)
  `).run(id, session.user_id, sessionId, relativePath, mimeTypeFor(contentType), buffer.byteLength);

  return {
    id,
    localUrl: mediaAssetUrl(id),
    relativePath,
    byteSize: buffer.byteLength,
  };
}

function markRecoveredShot(database, sessionId, scene, shotIndex, localUrl) {
  const shotPlan = parseShotPlan(scene);
  if (shotIndex < 0 || shotIndex >= shotPlan.length) {
    throw new Error(`Sub-scene ${shotIndex + 1} is not available for scene ${scene.scene_index + 1}.`);
  }

  shotPlan[shotIndex] = {
    ...shotPlan[shotIndex],
    url: localUrl,
    status: 'succeeded',
  };
  delete shotPlan[shotIndex].last_error;

  const videoUrls = shotPlan.map((shot) => shot?.url).filter((url) => typeof url === 'string' && url.trim());
  const sceneComplete = videoUrls.length === shotPlan.length;
  const videoUrlValue = sceneComplete ? JSON.stringify(videoUrls) : scene.video_url;
  const sceneStatus = sceneComplete ? 'completed' : scene.status;

  database.prepare(`
    UPDATE scenes
    SET shot_plan_json = ?,
        video_url = ?,
        status = ?,
        last_failure = NULL
    WHERE id = ?
  `).run(JSON.stringify(shotPlan), videoUrlValue || null, sceneStatus, scene.id);

  if (sceneComplete) {
    database.prepare(`
      UPDATE media_tasks
      SET status = 'succeeded',
          output_asset_id = ?,
          completed_at = CURRENT_TIMESTAMP,
          last_error = NULL
      WHERE session_id = ?
        AND scene_id = ?
        AND kind = 'generate_video_shot'
    `).run(videoUrlValue, sessionId, scene.id);
  }

  const allScenesDone = database.prepare(`
    SELECT COUNT(*) AS incomplete
    FROM scenes
    WHERE session_id = ?
      AND (video_url IS NULL OR video_url = '')
  `).get(sessionId).incomplete === 0;

  if (allScenesDone) {
    database.prepare(`
      UPDATE sessions
      SET status = CASE WHEN status = 'COMPLETED' THEN status ELSE 'PREVIEW_READY' END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionId);
  }

  return {
    sceneComplete,
    allScenesDone,
    videoUrlValue,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionId = requireArg(args, 'session-id');
  const shotIndex = optionalPositiveIndex(args, 'shot-index');
  if (shotIndex === undefined) throw new Error('Missing --shot-index');

  const database = new Database(databasePath(args));
  const scene = readScene(database, sessionId, args);
  const existingLocalUrl = localUrlFromExistingAsset(database, sessionId, args);
  const outputUrl = existingLocalUrl ? null : await retrieveRunwayOutputUrl(args, database, sessionId);
  const existingShotPlan = parseShotPlan(scene);

  console.log(`Recovering session ${sessionId}`);
  console.log(`Scene ${scene.scene_index + 1} (${scene.id}), sub-scene ${shotIndex + 1}`);
  if (existingLocalUrl) {
    console.log(`Existing media URL: ${existingLocalUrl}`);
  } else {
    console.log(`Output URL: ${outputUrl}`);
  }

  if (args['dry-run']) {
    console.log('Dry run: no files or DB rows were changed.');
    console.log(`Existing shot status: ${JSON.stringify(existingShotPlan[shotIndex] || null)}`);
    return;
  }

  const asset = existingLocalUrl ? null : await persistVideoAsset(database, args, sessionId, outputUrl);
  const result = markRecoveredShot(database, sessionId, scene, shotIndex, existingLocalUrl || asset.localUrl);

  if (asset) {
    console.log(`Saved media asset: ${asset.localUrl}`);
    console.log(`Stored file: ${asset.relativePath} (${asset.byteSize} bytes)`);
  } else {
    console.log(`Linked existing media asset: ${existingLocalUrl}`);
  }
  console.log(`Scene complete: ${result.sceneComplete ? 'yes' : 'no'}`);
  console.log(`All scenes done: ${result.allScenesDone ? 'yes' : 'no'}`);
}

main().catch((error) => {
  console.error(error.message);
  console.error('');
  console.error(usage());
  process.exit(1);
});
