import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

type SqliteDatabase = Database.Database;

const STALE_TURN_SECONDS = 10 * 60;

function columnExists(database: SqliteDatabase, tableName: string, columnName: string) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all()
    .some((column) => (column as { name: string }).name === columnName);
}

function addColumnIfMissing(database: SqliteDatabase, tableName: string, columnName: string, definition: string) {
  if (!columnExists(database, tableName, columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

export function initializeInterviewTurnGuard(database: SqliteDatabase) {
  addColumnIfMissing(database, 'sessions', 'interview_processing_token', 'interview_processing_token TEXT');
  addColumnIfMissing(database, 'sessions', 'interview_processing_started_at', 'interview_processing_started_at DATETIME');
}

export function tryAcquireInterviewTurn(database: SqliteDatabase, sessionId: string) {
  initializeInterviewTurnGuard(database);

  const token = uuidv4();
  const staleModifier = `-${STALE_TURN_SECONDS} seconds`;
  const result = database.prepare(`
    UPDATE sessions
    SET interview_processing_token = ?,
        interview_processing_started_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (
        interview_processing_token IS NULL
        OR interview_processing_token = ''
        OR interview_processing_started_at IS NULL
        OR interview_processing_started_at < datetime('now', ?)
      )
  `).run(token, sessionId, staleModifier);

  return result.changes > 0 ? token : null;
}

export function releaseInterviewTurn(database: SqliteDatabase, sessionId: string, token: string) {
  initializeInterviewTurnGuard(database);

  const result = database.prepare(`
    UPDATE sessions
    SET interview_processing_token = NULL,
        interview_processing_started_at = NULL
    WHERE id = ?
      AND interview_processing_token = ?
  `).run(sessionId, token);

  return result.changes > 0;
}

export function isInterviewTurnProcessing(database: SqliteDatabase, sessionId: string) {
  initializeInterviewTurnGuard(database);

  const row = database.prepare(`
    SELECT interview_processing_token, interview_processing_started_at
    FROM sessions
    WHERE id = ?
  `).get(sessionId) as { interview_processing_token?: string | null; interview_processing_started_at?: string | null } | undefined;
  if (!row?.interview_processing_token) return false;
  if (!row.interview_processing_started_at) return true;

  const startedAt = Date.parse(`${row.interview_processing_started_at} UTC`);
  if (!Number.isFinite(startedAt)) return true;
  return Date.now() - startedAt < STALE_TURN_SECONDS * 1000;
}
