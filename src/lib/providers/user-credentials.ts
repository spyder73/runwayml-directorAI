import type Database from 'better-sqlite3';
import RunwayML from '@runwayml/sdk';
import { createOpenRouterModel } from '../ai';
import { decryptCredential } from '../crypto/credentials';
import { normalizeFinalRenderBackend } from '../final-render-backend';
import { getRunwayVideoModel, normalizeRunwayVideoModel } from '../production-config';
import type { FinalRenderBackend, RunwayConcurrencyMode, RunwayVideoModel, SessionRow, UserApiCredentialsRow, UserSettingsRow } from '../types';

type SqliteDatabase = Database.Database;
type ProviderName = 'openrouter' | 'runway';

export const MISSING_BYOK_MESSAGE = 'Add your API keys in settings to start live generation.';

export class MissingUserCredentialError extends Error {
  provider: ProviderName;
  status = 400;

  constructor(provider: ProviderName) {
    super(MISSING_BYOK_MESSAGE);
    this.name = 'MissingUserCredentialError';
    this.provider = provider;
  }
}

export function isMissingUserCredentialError(error: unknown): error is MissingUserCredentialError {
  return error instanceof MissingUserCredentialError;
}

export function safeCredentialErrorMessage(error: unknown, fallback = 'Generation failed. Please try again.') {
  return isMissingUserCredentialError(error) ? MISSING_BYOK_MESSAGE : fallback;
}

function hasTable(database: SqliteDatabase, tableName: string) {
  try {
    return (database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(tableName) as { name?: string } | undefined)?.name === tableName;
  } catch {
    return false;
  }
}

function hasColumn(database: SqliteDatabase, tableName: string, columnName: string) {
  try {
    return (database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
      .some((column) => column.name === columnName);
  } catch {
    return false;
  }
}

function getSessionUserId(database: SqliteDatabase, sessionOrId: string | Pick<SessionRow, 'id' | 'user_id'>) {
  if (typeof sessionOrId !== 'string') return sessionOrId.user_id || null;
  if (!hasColumn(database, 'sessions', 'user_id')) return null;

  const session = database.prepare('SELECT user_id FROM sessions WHERE id = ?').get(sessionOrId) as Pick<SessionRow, 'user_id'> | undefined;
  return session?.user_id || null;
}

function readSettings(database: SqliteDatabase, userId: string) {
  if (!hasTable(database, 'user_settings')) return undefined;
  return database.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettingsRow | undefined;
}

function readCredentials(database: SqliteDatabase, userId: string) {
  if (!hasTable(database, 'user_api_credentials')) return undefined;
  return database.prepare('SELECT * FROM user_api_credentials WHERE user_id = ?').get(userId) as UserApiCredentialsRow | undefined;
}

function decryptEnvelope(
  row: UserApiCredentialsRow | undefined,
  encryptedKey: keyof UserApiCredentialsRow,
  ivKey: keyof UserApiCredentialsRow,
  tagKey: keyof UserApiCredentialsRow,
) {
  const encrypted = row?.[encryptedKey];
  const iv = row?.[ivKey];
  const tag = row?.[tagKey];
  if (typeof encrypted !== 'string' || typeof iv !== 'string' || typeof tag !== 'string') {
    return undefined;
  }

  const plainText = decryptCredential({ encrypted, iv, tag }).trim();
  return plainText || undefined;
}

export function getUserProviderCredentials(database: SqliteDatabase, userId: string | null | undefined) {
  if (!userId) {
    return {
      openrouterApiKey: undefined,
      runwayApiKey: undefined,
      runwayConcurrencyMode: 'serial' as RunwayConcurrencyMode,
      runwayVideoModel: getRunwayVideoModel(),
      finalRenderBackend: 'local' as FinalRenderBackend,
    };
  }

  const settings = readSettings(database, userId);
  const credentials = readCredentials(database, userId);

  return {
    openrouterApiKey: decryptEnvelope(credentials, 'openrouter_key_encrypted', 'openrouter_key_iv', 'openrouter_key_tag'),
    runwayApiKey: decryptEnvelope(credentials, 'runway_key_encrypted', 'runway_key_iv', 'runway_key_tag'),
    runwayConcurrencyMode: settings?.runway_concurrency_mode === 'parallel' ? 'parallel' as const : 'serial' as const,
    runwayVideoModel: normalizeRunwayVideoModel(settings?.runway_video_model, getRunwayVideoModel()),
    finalRenderBackend: normalizeFinalRenderBackend(settings?.final_render_backend),
  };
}

export function getSessionProviderCredentials(database: SqliteDatabase, sessionOrId: string | Pick<SessionRow, 'id' | 'user_id'>) {
  return getUserProviderCredentials(database, getSessionUserId(database, sessionOrId));
}

export function getRunwayConcurrencyModeForSession(
  database: SqliteDatabase,
  sessionOrId: string | Pick<SessionRow, 'id' | 'user_id'>,
): RunwayConcurrencyMode {
  return getSessionProviderCredentials(database, sessionOrId).runwayConcurrencyMode;
}

export function getRunwayVideoModelForSession(
  database: SqliteDatabase,
  sessionOrId: string | Pick<SessionRow, 'id' | 'user_id'>,
): RunwayVideoModel {
  return getSessionProviderCredentials(database, sessionOrId).runwayVideoModel;
}

export function getFinalRenderBackendForSession(
  database: SqliteDatabase,
  sessionOrId: string | Pick<SessionRow, 'id' | 'user_id'>,
): FinalRenderBackend {
  return getSessionProviderCredentials(database, sessionOrId).finalRenderBackend;
}

export function requireOpenRouterApiKeyForSession(database: SqliteDatabase, sessionOrId: string | Pick<SessionRow, 'id' | 'user_id'>) {
  const apiKey = getSessionProviderCredentials(database, sessionOrId).openrouterApiKey;
  if (!apiKey) throw new MissingUserCredentialError('openrouter');
  return apiKey;
}

export function requireRunwayApiKeyForSession(database: SqliteDatabase, sessionOrId: string | Pick<SessionRow, 'id' | 'user_id'>) {
  const apiKey = getSessionProviderCredentials(database, sessionOrId).runwayApiKey;
  if (!apiKey) throw new MissingUserCredentialError('runway');
  return apiKey;
}

export function openRouterModelForSession(
  database: SqliteDatabase,
  sessionOrId: string | Pick<SessionRow, 'id' | 'user_id'>,
  modelId: string,
) {
  return createOpenRouterModel(requireOpenRouterApiKeyForSession(database, sessionOrId), modelId);
}

export function createRunwayClientForApiKey(apiKey: string) {
  return new RunwayML({ apiKey });
}

export function createRunwayClientForSession(database: SqliteDatabase, sessionOrId: string | Pick<SessionRow, 'id' | 'user_id'>) {
  return createRunwayClientForApiKey(requireRunwayApiKeyForSession(database, sessionOrId));
}
