import fs from 'fs';
import path from 'path';

export type ConversationLogRole = 'user' | 'assistant' | 'tool' | 'system';

export type ConversationLogEvent = {
  sessionId: string;
  event: string;
  role?: ConversationLogRole;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
};

function truthyEnv(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(value?.trim() || '');
}

export function conversationLoggingEnabled() {
  return truthyEnv(process.env.LOG_CONVERSATIONS);
}

export function conversationLogDirectory() {
  return path.resolve(process.env.CONVERSATION_LOG_DIR || path.join(process.cwd(), 'data', 'conversation-logs'));
}

function safeSessionLogName(sessionId: string) {
  return sessionId
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'unknown-session';
}

export function conversationLogPathForSession(sessionId: string) {
  return path.join(conversationLogDirectory(), `${safeSessionLogName(sessionId)}.jsonl`);
}

function redactSecrets(serializedEntry: string) {
  return serializedEntry
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9._-]{20,}/g, 'sk-[REDACTED]')
    .replace(/\bkey_[A-Za-z0-9._-]+/g, 'key_[REDACTED]')
    .replace(/("(?:apiKey|token|sessionKey|secret)"\s*:\s*")[^"]+"/gi, '$1[REDACTED]"');
}

export function logConversationEvent(input: ConversationLogEvent) {
  if (!conversationLoggingEnabled()) return;

  try {
    const entry = {
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      event: input.event,
      role: input.role || null,
      content: input.content ?? null,
      metadata: input.metadata || null,
    };
    const logPath = conversationLogPathForSession(input.sessionId);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${redactSecrets(JSON.stringify(entry))}\n`, 'utf8');
  } catch (error) {
    console.warn('[conversation-log] Failed to write conversation log:', error);
  }
}
