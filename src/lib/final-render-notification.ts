import type Database from 'better-sqlite3';
import type { SessionRow } from './types';
import { sendFinalRenderEmail } from './email/smtp';

type SqliteDatabase = Database.Database;

export async function notifyFinalRenderReady(database: SqliteDatabase, sessionId: string, videoUrl: string) {
  const session = database.prepare(`
    SELECT * FROM sessions
    WHERE id = ?
  `).get(sessionId) as SessionRow | undefined;

  if (!session?.render_notification_email || session.render_notification_sent_at) {
    return { sent: false, reason: 'No unsent notification email configured' };
  }

  const result = await sendFinalRenderEmail({
    to: session.render_notification_email,
    videoUrl,
  });

  if (result.sent) {
    database.prepare(`
      UPDATE sessions
      SET render_notification_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionId);
  }

  return result;
}
