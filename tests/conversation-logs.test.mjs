import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});

function withConversationLogEnv(callback) {
  const previousEnabled = process.env.LOG_CONVERSATIONS;
  const previousDir = process.env.CONVERSATION_LOG_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifestory-conversation-logs-'));

  try {
    return callback(tempDir);
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.LOG_CONVERSATIONS;
    } else {
      process.env.LOG_CONVERSATIONS = previousEnabled;
    }

    if (previousDir === undefined) {
      delete process.env.CONVERSATION_LOG_DIR;
    } else {
      process.env.CONVERSATION_LOG_DIR = previousDir;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('conversation logs are disabled unless LOG_CONVERSATIONS is truthy', () => withConversationLogEnv((tempDir) => {
  const { logConversationEvent } = jiti('../src/lib/conversation-logs.ts');
  process.env.CONVERSATION_LOG_DIR = tempDir;
  delete process.env.LOG_CONVERSATIONS;

  logConversationEvent({
    sessionId: 'session-1',
    event: 'user_text',
    role: 'user',
    content: 'hello',
  });

  assert.equal(fs.existsSync(path.join(tempDir, 'session-1.jsonl')), false);
}));

test('conversation logs append JSONL events into a session reference folder', () => withConversationLogEnv((tempDir) => {
  const { conversationLogPathForSession, logConversationEvent } = jiti('../src/lib/conversation-logs.ts');
  process.env.LOG_CONVERSATIONS = 'true';
  process.env.CONVERSATION_LOG_DIR = tempDir;

  logConversationEvent({
    sessionId: '../session:one',
    event: 'user_text',
    role: 'user',
    content: 'When I was little, Interstellar made me want to study physics.',
    metadata: { status: 'INTERVIEW_DYNAMIC' },
  });
  logConversationEvent({
    sessionId: '../session:one',
    event: 'assistant_message',
    role: 'assistant',
    content: 'What image from that memory should appear on screen?',
  });

  const logPath = conversationLogPathForSession('../session:one');
  assert.equal(logPath.startsWith(tempDir), true);
  assert.match(path.basename(logPath), /^session_one\.jsonl$/);

  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].sessionId, '../session:one');
  assert.equal(lines[0].event, 'user_text');
  assert.equal(lines[0].role, 'user');
  assert.equal(lines[0].metadata.status, 'INTERVIEW_DYNAMIC');
  assert.match(lines[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(lines[1].event, 'assistant_message');
}));

test('conversation logging is wired into text, upload, and director pipeline turns', () => {
  const interviewRouteSource = fs.readFileSync(new URL('../src/app/api/pipeline/interview/route.ts', import.meta.url), 'utf8');
  const uploadRouteSource = fs.readFileSync(new URL('../src/app/api/pipeline/upload/route.ts', import.meta.url), 'utf8');
  const pipelineSource = fs.readFileSync(new URL('../src/lib/pipeline.ts', import.meta.url), 'utf8');
  const avatarToolsSource = fs.readFileSync(new URL('../src/lib/avatar/tools.ts', import.meta.url), 'utf8');
  const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

  assert.match(interviewRouteSource, /logConversationEvent/);
  assert.match(interviewRouteSource, /event:\s*'user_text'/);

  assert.match(uploadRouteSource, /logConversationEvent/);
  assert.match(uploadRouteSource, /event:\s*'user_upload'/);

  assert.match(pipelineSource, /logConversationEvent/);
  assert.match(pipelineSource, /event:\s*'ai_tool_call'/);
  assert.match(pipelineSource, /event:\s*'assistant_message'/);

  assert.match(avatarToolsSource, /logConversationEvent/);
  assert.match(avatarToolsSource, /source:\s*'avatar'/);

  assert.match(envExample, /LOG_CONVERSATIONS/);
});
