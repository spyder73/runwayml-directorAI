import type Database from 'better-sqlite3';
import type { SessionRow } from './types';
import type { MediaTaskRow } from './media-tasks';
import { sendFinalRenderEmail, sendGenerationFailureEmail } from './email/smtp';

type SqliteDatabase = Database.Database;

type FinalRenderNotificationRecipientInput = {
  render_notification_email?: string | null;
  account_email?: string | null;
};

export function finalRenderNotificationRecipients(input: FinalRenderNotificationRecipientInput) {
  const recipients: string[] = [];
  const seen = new Set<string>();

  for (const rawEmail of [input.render_notification_email, input.account_email]) {
    const email = rawEmail?.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push(email);
  }

  return recipients;
}

function tableExists(database: SqliteDatabase, tableName: string) {
  const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(table);
}

function getNotificationSession(database: SqliteDatabase, sessionId: string) {
  if (!tableExists(database, 'users')) {
    return database.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  }

  return database.prepare(`
    SELECT sessions.*, users.email AS account_email
    FROM sessions
    LEFT JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ?
  `).get(sessionId) as (SessionRow & { account_email?: string | null }) | undefined;
}

export async function notifyFinalRenderReady(database: SqliteDatabase, sessionId: string, videoUrl: string) {
  const session = getNotificationSession(database, sessionId);

  const recipients = session ? finalRenderNotificationRecipients(session) : [];
  if (!session || recipients.length === 0 || session.render_notification_sent_at) {
    return { sent: false, reason: 'No unsent notification email configured' };
  }

  const results = await Promise.all(recipients.map((to) => sendFinalRenderEmail({
    to,
    videoUrl,
    sessionId,
  })));
  const sent = results.some((result) => result.sent);

  if (sent) {
    database.prepare(`
      UPDATE sessions
      SET render_notification_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionId);
  }

  return {
    sent,
    recipients,
    reason: sent ? undefined : results.map((result) => result.reason).find(Boolean),
    videoUrl: results.find((result) => result.videoUrl)?.videoUrl,
  };
}

export async function notifyGenerationRetriesExhausted(database: SqliteDatabase, task: MediaTaskRow) {
  const session = getNotificationSession(database, task.session_id);

  const recipients = session ? finalRenderNotificationRecipients(session) : [];
  if (!session || recipients.length === 0 || task.auto_failure_notification_sent_at) {
    return { sent: false, reason: 'No unsent generation failure notification configured' };
  }

  const results = await Promise.all(recipients.map((to) => sendGenerationFailureEmail({
    to,
    sessionId: task.session_id,
  })));
  const sent = results.some((result) => result.sent);

  if (sent) {
    database.prepare(`
      UPDATE media_tasks
      SET auto_failure_notification_sent_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(task.id);
  }

  return {
    sent,
    recipients,
    reason: sent ? undefined : results.map((result) => result.reason).find(Boolean),
    failureUrl: results.find((result) => result.failureUrl)?.failureUrl,
  };
}
