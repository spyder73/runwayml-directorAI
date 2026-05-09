import { EventEmitter } from 'events';
import type { SessionUpdatePayload } from './types';

class SSEEmitter extends EventEmitter {}

// Global singleton to survive HMR in dev
const globalForSSE = global as unknown as { sseEmitter: SSEEmitter };
export const sseEmitter = globalForSSE.sseEmitter || new SSEEmitter();

if (process.env.NODE_ENV !== 'production') globalForSSE.sseEmitter = sseEmitter;

// Helper to broadcast changes
export function broadcastSessionUpdate(sessionId: string, payload: SessionUpdatePayload) {
  sseEmitter.emit(`session:${sessionId}`, payload);
}
