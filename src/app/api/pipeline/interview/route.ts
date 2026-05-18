import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { authGuardResponse, requireOwnedSessionForRequest } from '@/lib/auth/guards';
import { logConversationEvent } from '@/lib/conversation-logs';
import { releaseInterviewTurn, tryAcquireInterviewTurn } from '@/lib/interview-turns';
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
  let turnToken: string | null = null;
  let sessionId: string | undefined;
  try {
    const body = await req.json() as { sessionId?: string; message?: string };
    sessionId = body.sessionId;
    const message = body.message;

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const { session } = requireOwnedSessionForRequest(req, sessionId);
    const activeRequestBeforeTurn = getActiveReferenceRequest(db, sessionId);
    if (session.status === 'OUTLINE_REVIEW' && !activeRequestBeforeTurn) {
      return NextResponse.json({ error: 'Use outline notes or approve it above before continuing the interview.' }, { status: 409 });
    }

    turnToken = tryAcquireInterviewTurn(db, sessionId);
    if (!turnToken) {
      return NextResponse.json({ error: 'An interview response is still being prepared.' }, { status: 409 });
    }

    // Save user message
    if (message) {
        db.prepare('INSERT INTO chat_history (id, session_id, role, content) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), sessionId, 'user', message);

        const activeRequest = activeRequestBeforeTurn || getActiveReferenceRequest(db, sessionId);
        logConversationEvent({
          sessionId,
          event: 'user_text',
          role: 'user',
          content: message,
          metadata: {
            status: session.status,
            activeReferenceRequestId: activeRequest?.id || null,
          },
        });
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
    await processInterviewTurn(sessionId, { turnToken });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (sessionId && turnToken) {
      releaseInterviewTurn(db, sessionId, turnToken);
    }
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
