import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { UserRow } from '@/lib/types';

type SqliteDatabase = Database.Database;

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

type ClockOptions = {
  now?: Date;
};

function nowDate(options?: ClockOptions) {
  return options?.now || new Date();
}

export function generateEmailVerificationToken() {
  return randomBytes(32).toString('base64url');
}

export function hashEmailVerificationToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createEmailVerificationToken(database: SqliteDatabase, userId: string, options?: ClockOptions) {
  const createdAt = nowDate(options);
  const expiresAt = new Date(createdAt.getTime() + EMAIL_VERIFICATION_TTL_MS);
  const token = generateEmailVerificationToken();
  const id = uuidv4();

  database.prepare(`
    INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, hashEmailVerificationToken(token), expiresAt.toISOString());

  return {
    id,
    token,
    expiresAt,
  };
}

export function verifyEmailToken(database: SqliteDatabase, token: string | null | undefined, options?: ClockOptions) {
  if (!token) return null;

  const tokenHash = hashEmailVerificationToken(token);
  const now = nowDate(options).toISOString();
  const row = database.prepare(`
    SELECT * FROM email_verification_tokens
    WHERE token_hash = ?
      AND used_at IS NULL
      AND expires_at > ?
    LIMIT 1
  `).get(tokenHash, now) as { id: string; user_id: string } | undefined;

  if (!row) return null;

  const transaction = database.transaction(() => {
    database.prepare('UPDATE email_verification_tokens SET used_at = ? WHERE id = ?').run(now, row.id);
    database.prepare(`
      UPDATE users
      SET email_confirmed_at = COALESCE(email_confirmed_at, ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(now, row.user_id);

    return database.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as UserRow | undefined;
  });

  return transaction() || null;
}
