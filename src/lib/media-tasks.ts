import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { resolveFinalRenderBackend } from './final-render-backend';
import { getFinalRenderBackendForSession } from './providers/user-credentials';
import type { FinalRenderBackend, RenderProgressPayload } from './types';

type SqliteDatabase = Database.Database;

export type MediaTaskKind =
  | 'vision_describe_upload'
  | 'generate_sketch'
  | 'generate_scene_frame'
  | 'generate_narration'
  | 'generate_video_shot'
  | 'render_final';

export type MediaTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type MediaTaskProvider = 'runway' | 'remotion' | 'local' | 'modal';
export const DEFAULT_AUTOMATIC_GENERATION_ATTEMPTS = 6;

export type RenderProgressDetail = {
  renderedFrames?: number | null;
  encodedFrames?: number | null;
  totalFrames?: number | null;
  stitchStage?: string | null;
};

export type MediaTaskProgressInput = {
  progress: number;
  message?: string | null;
  detail?: RenderProgressDetail;
};

export type MediaTaskRow = {
  id: string;
  session_id: string;
  scene_id: string | null;
  shot_id: string | null;
  kind: MediaTaskKind;
  status: MediaTaskStatus;
  depends_on_task_ids_json: string;
  provider: MediaTaskProvider;
  request_json: string | null;
  output_asset_id: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  progress: number;
  progress_message: string | null;
  progress_detail_json: string | null;
  progress_updated_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type FinalRenderBackendEnv = {
  [key: string]: string | undefined;
  FINAL_RENDER_BACKEND?: string | undefined;
};

function existingColumns(database: SqliteDatabase, tableName: string) {
  return new Set((database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function addColumnIfMissing(database: SqliteDatabase, tableName: string, columnName: string, definition: string) {
  if (existingColumns(database, tableName).has(columnName)) return;
  database.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`).run();
}

export function initializeMediaTaskTables(database: SqliteDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS media_tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      scene_id TEXT,
      shot_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      depends_on_task_ids_json TEXT NOT NULL DEFAULT '[]',
      provider TEXT NOT NULL,
      request_json TEXT,
      output_asset_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 6,
      last_error TEXT,
      progress REAL NOT NULL DEFAULT 0,
      progress_message TEXT,
      progress_detail_json TEXT,
      progress_updated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_media_tasks_session_status
      ON media_tasks(session_id, status);
  `);

  addColumnIfMissing(database, 'media_tasks', 'progress', 'progress REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'media_tasks', 'progress_message', 'progress_message TEXT');
  addColumnIfMissing(database, 'media_tasks', 'progress_detail_json', 'progress_detail_json TEXT');
  addColumnIfMissing(database, 'media_tasks', 'progress_updated_at', 'progress_updated_at DATETIME');
}

function jsonArray(value: string[] | undefined) {
  return JSON.stringify(value || []);
}

export function finalRenderTaskProvider(
  env: FinalRenderBackendEnv = process.env,
  preference: FinalRenderBackend = 'local',
): MediaTaskProvider {
  return resolveFinalRenderBackend(env, preference);
}

function parseTaskIds(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function createMediaTask(database: SqliteDatabase, input: {
  id?: string;
  sessionId: string;
  sceneId?: string;
  shotId?: string;
  kind: MediaTaskKind;
  provider: MediaTaskProvider;
  dependsOnTaskIds?: string[];
  requestJson?: unknown;
  maxAttempts?: number;
}) {
  const id = input.id || uuidv4();
  database.prepare(`
    INSERT INTO media_tasks (
      id, session_id, scene_id, shot_id, kind, status, depends_on_task_ids_json,
      provider, request_json, max_attempts
    )
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
  `).run(
    id,
    input.sessionId,
    input.sceneId || null,
    input.shotId || null,
    input.kind,
    jsonArray(input.dependsOnTaskIds),
    input.provider,
    input.requestJson ? JSON.stringify(input.requestJson) : null,
    input.maxAttempts ?? DEFAULT_AUTOMATIC_GENERATION_ATTEMPTS,
  );

  return database.prepare('SELECT * FROM media_tasks WHERE id = ?').get(id) as MediaTaskRow;
}

export function createMediaTaskDagForScenes(database: SqliteDatabase, params: {
  sessionId: string;
  scenes: Array<{ id: string; scene_index?: number }>;
}) {
  database.prepare('DELETE FROM media_tasks WHERE session_id = ?').run(params.sessionId);
  const videoTaskIds: string[] = [];

  for (const scene of params.scenes) {
    const frame = createMediaTask(database, {
      sessionId: params.sessionId,
      sceneId: scene.id,
      kind: 'generate_scene_frame',
      provider: 'runway',
    });
    const narration = createMediaTask(database, {
      sessionId: params.sessionId,
      sceneId: scene.id,
      kind: 'generate_narration',
      provider: 'runway',
    });
    const video = createMediaTask(database, {
      sessionId: params.sessionId,
      sceneId: scene.id,
      kind: 'generate_video_shot',
      provider: 'runway',
      dependsOnTaskIds: [frame.id, narration.id],
    });
    videoTaskIds.push(video.id);
  }

  createMediaTask(database, {
    sessionId: params.sessionId,
    kind: 'render_final',
    provider: finalRenderTaskProvider(process.env, getFinalRenderBackendForSession(database, params.sessionId)),
    dependsOnTaskIds: videoTaskIds,
  });

  return database.prepare('SELECT * FROM media_tasks WHERE session_id = ? ORDER BY created_at ASC').all(params.sessionId) as MediaTaskRow[];
}

export function selectRunnableMediaTasks(database: SqliteDatabase, sessionId: string, limit = 10) {
  const queued = database.prepare(`
    SELECT * FROM media_tasks
    WHERE session_id = ? AND status = 'queued' AND attempts < max_attempts
    ORDER BY created_at ASC
  `).all(sessionId) as MediaTaskRow[];

  const succeeded = new Set((database.prepare(`
    SELECT id FROM media_tasks
    WHERE session_id = ? AND status = 'succeeded'
  `).all(sessionId) as Array<{ id: string }>).map((row) => row.id));

  return queued
    .filter((task) => parseTaskIds(task.depends_on_task_ids_json).every((id) => succeeded.has(id)))
    .slice(0, limit);
}

export function markMediaTaskRunning(database: SqliteDatabase, taskId: string) {
  database.prepare(`
    UPDATE media_tasks
    SET status = 'running',
        started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
        last_error = NULL,
        progress = CASE WHEN kind = 'render_final' THEN 0 ELSE progress END,
        progress_message = CASE WHEN kind = 'render_final' THEN 'Preparing final render' ELSE progress_message END,
        progress_detail_json = CASE WHEN kind = 'render_final' THEN NULL ELSE progress_detail_json END,
        progress_updated_at = CASE WHEN kind = 'render_final' THEN CURRENT_TIMESTAMP ELSE progress_updated_at END
    WHERE id = ?
  `).run(taskId);
}

export function completeMediaTask(database: SqliteDatabase, taskId: string, outputAssetId?: string) {
  database.prepare(`
    UPDATE media_tasks
    SET status = 'succeeded',
        output_asset_id = COALESCE(?, output_asset_id),
        completed_at = CURRENT_TIMESTAMP,
        last_error = NULL,
        progress = CASE WHEN kind = 'render_final' THEN 1 ELSE progress END,
        progress_message = CASE WHEN kind = 'render_final' THEN COALESCE(progress_message, 'Final video ready') ELSE progress_message END,
        progress_updated_at = CASE WHEN kind = 'render_final' THEN CURRENT_TIMESTAMP ELSE progress_updated_at END
    WHERE id = ?
  `).run(outputAssetId || null, taskId);
}

export function failMediaTask(database: SqliteDatabase, taskId: string, error: string) {
  database.prepare(`
    UPDATE media_tasks
    SET status = 'failed',
        attempts = attempts + 1,
        last_error = ?,
        completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(error, taskId);
}

export function forceFailMediaTask(database: SqliteDatabase, taskId: string, error: string) {
  database.prepare(`
    UPDATE media_tasks
    SET status = 'failed', attempts = attempts + 1, last_error = ?, completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(error, taskId);
}

export function resetFailedMediaTasks(database: SqliteDatabase, params: {
  sessionId: string;
  kind?: MediaTaskKind;
  sceneId?: string;
}) {
  const clauses = ['session_id = ?', "status IN ('failed', 'cancelled')"];
  const values: unknown[] = [params.sessionId];
  if (params.kind) {
    clauses.push('kind = ?');
    values.push(params.kind);
  }
  if (params.sceneId) {
    clauses.push('scene_id = ?');
    values.push(params.sceneId);
  }

  database.prepare(`
    UPDATE media_tasks
    SET status = 'queued',
        attempts = 0,
        last_error = NULL,
        completed_at = NULL,
        progress = 0,
        progress_message = NULL,
        progress_detail_json = NULL,
        progress_updated_at = NULL
    WHERE ${clauses.join(' AND ')}
  `).run(...values);
}

export function requeueMediaTasks(database: SqliteDatabase, params: {
  sessionId: string;
  kind?: MediaTaskKind;
  sceneId?: string;
  clearOutput?: boolean;
}) {
  const clauses = ['session_id = ?'];
  const values: unknown[] = [params.sessionId];
  if (params.kind) {
    clauses.push('kind = ?');
    values.push(params.kind);
  }
  if (params.sceneId) {
    clauses.push('scene_id = ?');
    values.push(params.sceneId);
  }

  database.prepare(`
    UPDATE media_tasks
    SET status = 'queued',
        ${params.clearOutput ? 'output_asset_id = NULL,' : ''}
        attempts = 0,
        last_error = NULL,
        started_at = NULL,
        completed_at = NULL,
        progress = 0,
        progress_message = NULL,
        progress_detail_json = NULL,
        progress_updated_at = NULL
    WHERE ${clauses.join(' AND ')}
  `).run(...values);
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, Number(value.toFixed(3))));
}

function nullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function parseProgressDetail(value: string | null): RenderProgressDetail {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const detail = parsed as Record<string, unknown>;
    return {
      renderedFrames: nullableNumber(detail.renderedFrames),
      encodedFrames: nullableNumber(detail.encodedFrames),
      totalFrames: nullableNumber(detail.totalFrames),
      stitchStage: nullableString(detail.stitchStage),
    };
  } catch {
    return {};
  }
}

function progressDetailJson(detail: RenderProgressDetail | undefined) {
  if (!detail) return null;
  return JSON.stringify({
    renderedFrames: nullableNumber(detail.renderedFrames),
    encodedFrames: nullableNumber(detail.encodedFrames),
    totalFrames: nullableNumber(detail.totalFrames),
    stitchStage: nullableString(detail.stitchStage),
  });
}

export function updateMediaTaskProgress(database: SqliteDatabase, taskId: string, input: MediaTaskProgressInput) {
  database.prepare(`
    UPDATE media_tasks
    SET progress = ?,
        progress_message = ?,
        progress_detail_json = ?,
        progress_updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    clampProgress(input.progress),
    input.message || null,
    progressDetailJson(input.detail),
    taskId,
  );
}

export function updateRenderProgressForSession(database: SqliteDatabase, sessionId: string, input: MediaTaskProgressInput) {
  const task = database.prepare(`
    SELECT id FROM media_tasks
    WHERE session_id = ? AND kind = 'render_final'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId) as { id: string } | undefined;
  if (!task) return;
  updateMediaTaskProgress(database, task.id, input);
}

export function getRenderProgressForSession(database: SqliteDatabase, sessionId: string): RenderProgressPayload | null {
  const task = database.prepare(`
    SELECT * FROM media_tasks
    WHERE session_id = ? AND kind = 'render_final'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId) as MediaTaskRow | undefined;

  if (!task || (!task.progress_updated_at && !task.progress_message && !task.progress_detail_json && task.progress <= 0)) {
    return null;
  }

  const detail = parseProgressDetail(task.progress_detail_json);
  return {
    progress: clampProgress(Number(task.progress || 0)),
    message: task.progress_message || 'Rendering frames',
    renderedFrames: nullableNumber(detail.renderedFrames),
    encodedFrames: nullableNumber(detail.encodedFrames),
    totalFrames: nullableNumber(detail.totalFrames),
    stitchStage: nullableString(detail.stitchStage),
    updatedAt: task.progress_updated_at || task.started_at || null,
  };
}

export function completeMediaTasksForScenePhase(database: SqliteDatabase, params: {
  sessionId: string;
  sceneId: string;
  kind: MediaTaskKind;
  outputAssetId?: string;
}) {
  const task = database.prepare(`
    SELECT * FROM media_tasks
    WHERE session_id = ? AND scene_id = ? AND kind = ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(params.sessionId, params.sceneId, params.kind) as MediaTaskRow | undefined;
  if (!task) return;
  completeMediaTask(database, task.id, params.outputAssetId);
}

export function completeMediaTaskForSessionKind(database: SqliteDatabase, params: {
  sessionId: string;
  kind: MediaTaskKind;
  outputAssetId?: string;
}) {
  const task = database.prepare(`
    SELECT * FROM media_tasks
    WHERE session_id = ? AND kind = ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(params.sessionId, params.kind) as MediaTaskRow | undefined;
  if (!task) return;
  completeMediaTask(database, task.id, params.outputAssetId);
}

export function failMediaTasksForScenePhase(database: SqliteDatabase, params: {
  sessionId: string;
  sceneId: string;
  kind: MediaTaskKind;
  error: string;
}) {
  const task = database.prepare(`
    SELECT * FROM media_tasks
    WHERE session_id = ? AND scene_id = ? AND kind = ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(params.sessionId, params.sceneId, params.kind) as MediaTaskRow | undefined;
  if (!task) return;
  forceFailMediaTask(database, task.id, params.error);
}

export function failMediaTaskForSessionKind(database: SqliteDatabase, params: {
  sessionId: string;
  kind: MediaTaskKind;
  error: string;
}) {
  const task = database.prepare(`
    SELECT * FROM media_tasks
    WHERE session_id = ? AND kind = ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(params.sessionId, params.kind) as MediaTaskRow | undefined;
  if (!task) return;
  forceFailMediaTask(database, task.id, params.error);
}
