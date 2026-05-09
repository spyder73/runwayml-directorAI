import { NextRequest } from 'next/server';
import { sseEmitter } from '@/lib/sse';
import db from '@/lib/db';
import type { ChatHistoryRow, SceneRow, SessionRow, SessionUpdatePayload } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return new Response('Missing sessionId', { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      // Send initial state immediately
      try {
          const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
          if (session) {
          const scenes = db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
          const chat_history = db.prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatHistoryRow[];
          const data = { session, scenes, chat_history };
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
        }
      } catch (err) {
        console.error('Failed to get initial session state', err);
      }

      // Keep connection alive with pings
      const pingInterval = setInterval(() => {
        controller.enqueue(': ping\n\n');
      }, 15000);

      // Listen for updates specific to this session
      const listener = (payload: SessionUpdatePayload) => {
        const message = `data: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(message);
      };

      sseEmitter.on(`session:${sessionId}`, listener);

      // Handle disconnect
      req.signal.addEventListener('abort', () => {
        clearInterval(pingInterval);
        sseEmitter.off(`session:${sessionId}`, listener);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
