import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { processInterviewTurn } from '@/lib/pipeline';
import type { SessionRow } from '@/lib/types';
import {
  getActiveReferenceRequest,
  markActiveReferenceRequest,
  saveReferenceDescription,
} from '@/lib/story-bucket';

function isSkipReferenceMessage(message: string) {
  return /\b(skip|no upload|without (a )?photo|rather not upload|do not upload|don't upload)\b/i.test(message);
}

function describedReference(message: string) {
  const match = message.match(/^here is how .+?:\s*(.+)$/i);
  return match?.[1]?.trim();
}

function nextStatusAfterReference(session: Pick<SessionRow, 'mode' | 'status'> | undefined, request: NonNullable<ReturnType<typeof getActiveReferenceRequest>>) {
  if (session?.mode === 'life_story' && request.target_type === 'protagonist' && request.reference_scope !== 'scene') {
    return 'INTERVIEW_PSYCH_PROFILE';
  }
  return 'INTERVIEW_DYNAMIC';
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId, message } = await req.json() as { sessionId?: string; message?: string };

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    // Save user message
    if (message) {
        db.prepare('INSERT INTO chat_history (id, session_id, role, content) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), sessionId, 'user', message);

        const activeRequest = getActiveReferenceRequest(db, sessionId);
        const session = db.prepare('SELECT mode, status FROM sessions WHERE id = ?').get(sessionId) as Pick<SessionRow, 'mode' | 'status'> | undefined;
        const shouldLeaveReferenceStatus = session?.status === 'AWAITING_SELFIE' || session?.status === 'AWAITING_REFERENCE';
        if (activeRequest && isSkipReferenceMessage(message)) {
          markActiveReferenceRequest(db, sessionId, 'skipped');
          if (shouldLeaveReferenceStatus) {
            db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(nextStatusAfterReference(session, activeRequest), sessionId);
          }
        } else if (activeRequest) {
          const description = describedReference(message);
          if (description) {
            saveReferenceDescription(db, sessionId, {
              targetType: activeRequest.target_type,
              targetLabel: activeRequest.target_label,
              description,
              usagePermissions: 'description_only',
            });
            if (shouldLeaveReferenceStatus) {
              db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(nextStatusAfterReference(session, activeRequest), sessionId);
            }
          }
        }
    }
    
    // Process asynchronously so we don't block the UI
    processInterviewTurn(sessionId).catch(console.error);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
