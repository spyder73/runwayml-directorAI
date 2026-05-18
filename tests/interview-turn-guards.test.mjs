import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      story_text TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '16:9'
    );
  `);
  db.prepare('INSERT INTO sessions (id, status) VALUES (?, ?)').run('session-1', 'INTERVIEW_DYNAMIC');
  return db;
}

test('interview turn guard serializes one processing turn per session', () => {
  const {
    initializeInterviewTurnGuard,
    isInterviewTurnProcessing,
    releaseInterviewTurn,
    tryAcquireInterviewTurn,
  } = jiti('../src/lib/interview-turns.ts');
  const db = createDb();

  initializeInterviewTurnGuard(db);

  const token = tryAcquireInterviewTurn(db, 'session-1');
  assert.equal(typeof token, 'string');
  assert.equal(isInterviewTurnProcessing(db, 'session-1'), true);
  assert.equal(tryAcquireInterviewTurn(db, 'session-1'), null);

  assert.equal(releaseInterviewTurn(db, 'session-1', 'wrong-token'), false);
  assert.equal(isInterviewTurnProcessing(db, 'session-1'), true);

  assert.equal(releaseInterviewTurn(db, 'session-1', token), true);
  assert.equal(isInterviewTurnProcessing(db, 'session-1'), false);
  assert.equal(typeof tryAcquireInterviewTurn(db, 'session-1'), 'string');
});

test('outline revision and locking routes share the interview turn guard', () => {
  const outlineRouteSource = fs.readFileSync(new URL('../src/app/api/pipeline/outline/route.ts', import.meta.url), 'utf8');
  const interviewRouteSource = fs.readFileSync(new URL('../src/app/api/pipeline/interview/route.ts', import.meta.url), 'utf8');

  assert.match(outlineRouteSource, /tryAcquireInterviewTurn/);
  assert.match(outlineRouteSource, /releaseInterviewTurn/);
  assert.match(outlineRouteSource, /action === 'ai_revise'/);
  assert.match(outlineRouteSource, /action === 'lock'/);
  assert.match(interviewRouteSource, /session\.status === 'OUTLINE_REVIEW'/);
  assert.match(interviewRouteSource, /getActiveReferenceRequest/);
  assert.match(interviewRouteSource, /Use outline notes or approve it/);
});
