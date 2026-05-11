import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

type SqliteDatabase = Database.Database;

export type AvatarCallEventInput = {
  avatarCallSessionId?: string | null;
  sessionId: string;
  runwaySessionId?: string | null;
  eventType: string;
  toolName?: string | null;
  durationMs?: number | null;
  payload?: unknown;
  errorMessage?: string | null;
};

function stringifyForLog(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function redactAvatarLogValue(value: unknown) {
  return stringifyForLog(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bkey_[A-Za-z0-9._-]+/g, 'key_[REDACTED]')
    .replace(/((?:apiKey|token|sessionKey)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/("(?:apiKey|token|sessionKey)"\s*:\s*")[^"]+"/gi, '$1[REDACTED]"');
}

export function recordAvatarCallEvent(database: SqliteDatabase, input: AvatarCallEventInput) {
  const id = uuidv4();
  database.prepare(`
    INSERT INTO avatar_call_events (
      id, avatar_call_session_id, session_id, runway_session_id, event_type,
      tool_name, duration_ms, payload_json, error_message
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.avatarCallSessionId || null,
    input.sessionId,
    input.runwaySessionId || null,
    input.eventType,
    input.toolName || null,
    input.durationMs ?? null,
    input.payload === undefined ? null : redactAvatarLogValue(input.payload),
    input.errorMessage ? redactAvatarLogValue(input.errorMessage) : null,
  );
  return id;
}

export function avatarDebugLog(label: string, payload?: unknown) {
  if (process.env.AVATAR_DEBUG_LOGS !== '1') return;
  if (payload === undefined) {
    console.log(`[avatar] ${label}`);
    return;
  }
  console.log(`[avatar] ${label}`, redactAvatarLogValue(payload));
}
