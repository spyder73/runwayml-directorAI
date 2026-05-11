import type Database from 'better-sqlite3';
import type { FinalRenderBackend, RunwayConcurrencyMode, RunwayVideoModel, UserApiCredentialsRow, UserSettingsRow } from '@/lib/types';
import { encryptCredential } from './crypto/credentials';
import { isFinalRenderBackend, isModalRenderingAvailable, normalizeFinalRenderBackend } from './final-render-backend';
import { normalizeRunwayVideoModel, isRunwayVideoModel } from './production-config';

type SqliteDatabase = Database.Database;

export type UserSettingsSummary = {
  openrouterKeySaved: boolean;
  runwayKeySaved: boolean;
  runwayConcurrencyMode: RunwayConcurrencyMode;
  runwayVideoModel: RunwayVideoModel;
  finalRenderBackend: FinalRenderBackend;
  modalRenderingAvailable: boolean;
};

export type UpdateUserSettingsInput = {
  openrouterApiKey?: unknown;
  runwayApiKey?: unknown;
  runwayConcurrencyMode?: unknown;
  runwayVideoModel?: unknown;
  finalRenderBackend?: unknown;
};

export class InvalidRunwayConcurrencyModeError extends Error {
  constructor() {
    super('Runway concurrency mode must be serial or parallel.');
    this.name = 'InvalidRunwayConcurrencyModeError';
  }
}

export class InvalidRunwayVideoModelError extends Error {
  constructor() {
    super('Runway video model must be gen4_turbo or veo3.1_fast.');
    this.name = 'InvalidRunwayVideoModelError';
  }
}

export class InvalidFinalRenderBackendError extends Error {
  constructor() {
    super('Final render backend must be local or modal.');
    this.name = 'InvalidFinalRenderBackendError';
  }
}

export function isRunwayConcurrencyMode(value: unknown): value is RunwayConcurrencyMode {
  return value === 'serial' || value === 'parallel';
}

function ensureSettingsRow(database: SqliteDatabase, userId: string) {
  database.prepare(`
    INSERT INTO user_settings (user_id)
    VALUES (?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId);
}

function readSettingsRow(database: SqliteDatabase, userId: string) {
  ensureSettingsRow(database, userId);

  return database.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettingsRow;
}

function readCredentialsRow(database: SqliteDatabase, userId: string) {
  return database.prepare('SELECT * FROM user_api_credentials WHERE user_id = ?').get(userId) as UserApiCredentialsRow | undefined;
}

function hasCredential(encrypted?: string | null, iv?: string | null, tag?: string | null) {
  return Boolean(encrypted && iv && tag);
}

function normalizeOptionalApiKey(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getUserSettings(database: SqliteDatabase, userId: string): UserSettingsSummary {
  const settings = readSettingsRow(database, userId);
  const credentials = readCredentialsRow(database, userId);

  return {
    openrouterKeySaved: hasCredential(
      credentials?.openrouter_key_encrypted,
      credentials?.openrouter_key_iv,
      credentials?.openrouter_key_tag,
    ),
    runwayKeySaved: hasCredential(
      credentials?.runway_key_encrypted,
      credentials?.runway_key_iv,
      credentials?.runway_key_tag,
    ),
    runwayConcurrencyMode: settings.runway_concurrency_mode,
    runwayVideoModel: normalizeRunwayVideoModel(settings.runway_video_model),
    finalRenderBackend: normalizeFinalRenderBackend(settings.final_render_backend),
    modalRenderingAvailable: isModalRenderingAvailable(),
  };
}

export function updateUserSettings(database: SqliteDatabase, userId: string, input: UpdateUserSettingsInput): UserSettingsSummary {
  ensureSettingsRow(database, userId);

  if (input.runwayConcurrencyMode !== undefined && input.runwayConcurrencyMode !== null) {
    if (!isRunwayConcurrencyMode(input.runwayConcurrencyMode)) {
      throw new InvalidRunwayConcurrencyModeError();
    }

    database.prepare(`
      UPDATE user_settings
      SET runway_concurrency_mode = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(input.runwayConcurrencyMode, userId);
  }

  if (input.runwayVideoModel !== undefined && input.runwayVideoModel !== null) {
    if (!isRunwayVideoModel(input.runwayVideoModel)) {
      throw new InvalidRunwayVideoModelError();
    }

    database.prepare(`
      UPDATE user_settings
      SET runway_video_model = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(input.runwayVideoModel, userId);
  }

  if (input.finalRenderBackend !== undefined && input.finalRenderBackend !== null) {
    if (!isFinalRenderBackend(input.finalRenderBackend)) {
      throw new InvalidFinalRenderBackendError();
    }

    database.prepare(`
      UPDATE user_settings
      SET final_render_backend = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(input.finalRenderBackend, userId);
  }

  const openrouterApiKey = normalizeOptionalApiKey(input.openrouterApiKey);
  const runwayApiKey = normalizeOptionalApiKey(input.runwayApiKey);

  if (openrouterApiKey || runwayApiKey) {
    const openrouterEnvelope = openrouterApiKey ? encryptCredential(openrouterApiKey) : null;
    const runwayEnvelope = runwayApiKey ? encryptCredential(runwayApiKey) : null;

    database.prepare(`
      INSERT INTO user_api_credentials (
        user_id,
        openrouter_key_encrypted,
        openrouter_key_iv,
        openrouter_key_tag,
        runway_key_encrypted,
        runway_key_iv,
        runway_key_tag
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        openrouter_key_encrypted = COALESCE(excluded.openrouter_key_encrypted, user_api_credentials.openrouter_key_encrypted),
        openrouter_key_iv = COALESCE(excluded.openrouter_key_iv, user_api_credentials.openrouter_key_iv),
        openrouter_key_tag = COALESCE(excluded.openrouter_key_tag, user_api_credentials.openrouter_key_tag),
        runway_key_encrypted = COALESCE(excluded.runway_key_encrypted, user_api_credentials.runway_key_encrypted),
        runway_key_iv = COALESCE(excluded.runway_key_iv, user_api_credentials.runway_key_iv),
        runway_key_tag = COALESCE(excluded.runway_key_tag, user_api_credentials.runway_key_tag),
        updated_at = CURRENT_TIMESTAMP
    `).run(
      userId,
      openrouterEnvelope?.encrypted ?? null,
      openrouterEnvelope?.iv ?? null,
      openrouterEnvelope?.tag ?? null,
      runwayEnvelope?.encrypted ?? null,
      runwayEnvelope?.iv ?? null,
      runwayEnvelope?.tag ?? null,
    );
  }

  return getUserSettings(database, userId);
}
