import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { encryptCredential, type EncryptedCredential } from '../crypto/credentials';
import { hashPasswordSync } from './password';

type SqliteDatabase = Database.Database;

export type ReviewerSeedResult = {
  seeded: boolean;
  userId?: string;
  credentialsSeeded: boolean;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function reviewerConfig() {
  const email = process.env.REVIEWER_EMAIL ? normalizeEmail(process.env.REVIEWER_EMAIL) : '';
  const password = process.env.REVIEWER_PASSWORD || '';

  if (!email || !password) {
    return null;
  }

  return {
    email,
    password,
    openrouterKey: process.env.REVIEWER_OPENROUTER_API_KEY || '',
    runwayKey: process.env.REVIEWER_RUNWAYML_API_SECRET || '',
  };
}

function encryptedOrExisting(rawValue: string, existing: EncryptedCredential): EncryptedCredential {
  if (!rawValue) return existing;
  return encryptCredential(rawValue);
}

export function seedReviewerAccount(database: SqliteDatabase): ReviewerSeedResult {
  const config = reviewerConfig();
  if (!config) {
    return { seeded: false, credentialsSeeded: false };
  }

  const existingUser = database.prepare('SELECT id FROM users WHERE email = ?')
    .get(config.email) as { id: string } | undefined;
  const userId = existingUser?.id || uuidv4();
  const passwordHash = hashPasswordSync(config.password);
  const now = new Date().toISOString();

  const seed = database.transaction(() => {
    if (existingUser) {
      database.prepare(`
        UPDATE users
        SET password_hash = ?,
            email_confirmed_at = COALESCE(email_confirmed_at, ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(passwordHash, now, userId);
    } else {
      database.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed_at)
        VALUES (?, ?, ?, ?)
      `).run(userId, config.email, passwordHash, now);
    }

    database.prepare(`
      INSERT INTO user_settings (user_id)
      VALUES (?)
      ON CONFLICT(user_id) DO NOTHING
    `).run(userId);

    const credentialsSeeded = Boolean(config.openrouterKey || config.runwayKey);
    if (credentialsSeeded) {
      const existingCredentials = database.prepare('SELECT * FROM user_api_credentials WHERE user_id = ?')
        .get(userId) as {
          openrouter_key_encrypted: string | null;
          openrouter_key_iv: string | null;
          openrouter_key_tag: string | null;
          runway_key_encrypted: string | null;
          runway_key_iv: string | null;
          runway_key_tag: string | null;
        } | undefined;

      const openrouter = encryptedOrExisting(config.openrouterKey, {
        encrypted: existingCredentials?.openrouter_key_encrypted || '',
        iv: existingCredentials?.openrouter_key_iv || '',
        tag: existingCredentials?.openrouter_key_tag || '',
      });
      const runway = encryptedOrExisting(config.runwayKey, {
        encrypted: existingCredentials?.runway_key_encrypted || '',
        iv: existingCredentials?.runway_key_iv || '',
        tag: existingCredentials?.runway_key_tag || '',
      });

      database.prepare(`
        INSERT INTO user_api_credentials (
          user_id,
          openrouter_key_encrypted,
          openrouter_key_iv,
          openrouter_key_tag,
          runway_key_encrypted,
          runway_key_iv,
          runway_key_tag,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          openrouter_key_encrypted = excluded.openrouter_key_encrypted,
          openrouter_key_iv = excluded.openrouter_key_iv,
          openrouter_key_tag = excluded.openrouter_key_tag,
          runway_key_encrypted = excluded.runway_key_encrypted,
          runway_key_iv = excluded.runway_key_iv,
          runway_key_tag = excluded.runway_key_tag,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        userId,
        openrouter.encrypted || null,
        openrouter.iv || null,
        openrouter.tag || null,
        runway.encrypted || null,
        runway.iv || null,
        runway.tag || null,
      );
    }

    return credentialsSeeded;
  });

  return {
    seeded: true,
    userId,
    credentialsSeeded: seed(),
  };
}
