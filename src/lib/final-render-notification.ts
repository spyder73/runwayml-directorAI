import type Database from 'better-sqlite3';
import type { SessionRow } from './types';
import { sendFinalRenderEmail } from './email/smtp';

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

export async function notifyFinalRenderReady(database: SqliteDatabase, sessionId: string, videoUrl: string) {
  const session = database.prepare(`
    SELECT sessions.*, users.email AS account_email
    FROM sessions
    LEFT JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ?
  `).get(sessionId) as (SessionRow & { account_email?: string | null }) | undefined;

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
