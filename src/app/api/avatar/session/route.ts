import { NextRequest, NextResponse } from 'next/server';
import RunwayML from '@runwayml/sdk';
import { consumeSession } from '@runwayml/avatars-react/api';
import type { RealtimeSessionCreateParams } from '@runwayml/sdk/resources/realtime-sessions';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { authGuardResponse, requireOwnedSessionForRequest } from '@/lib/auth/guards';
import { getSessionProviderCredentials } from '@/lib/providers/user-credentials';
import { loadStoryBucket } from '@/lib/story-bucket';
import {
  buildAvatarPersonality,
  buildAvatarStartScript,
  buildStoryContextForAvatar,
} from '@/lib/avatar/prompts';
import { avatarSessionTools } from '@/lib/avatar/tool-definitions';
import { avatarDebugLog, recordAvatarCallEvent, redactAvatarLogValue } from '@/lib/avatar/logging';

export const runtime = 'nodejs';

type AvatarSessionRequest = {
  appSessionId?: string;
  avatarId?: string;
};

type AvatarRpcHandler = unknown;
type AvatarRpcRuntime = typeof import('@runwayml/avatars-node-rpc');
type AvatarReadySession = Awaited<ReturnType<RunwayML['realtimeSessions']['retrieve']>>;

const DEFAULT_AVATAR_SESSION_READY_TIMEOUT_MS = 60_000;
const configuredAvatarReadyTimeoutMs = Number.parseInt(process.env.RUNWAY_CHARACTER_SESSION_READY_TIMEOUT_MS || '', 10);
const AVATAR_SESSION_READY_TIMEOUT_MS = Number.isFinite(configuredAvatarReadyTimeoutMs) && configuredAvatarReadyTimeoutMs > 0
  ? configuredAvatarReadyTimeoutMs
  : DEFAULT_AVATAR_SESSION_READY_TIMEOUT_MS;
const AVATAR_SESSION_READY_POLL_MS = 1_000;
const AVATAR_SESSION_STATUS_LOG_EVERY_ATTEMPTS = 10;

const globalForAvatarRpc = globalThis as typeof globalThis & {
  __lifestoryAvatarRpcHandlers?: Map<string, AvatarRpcHandler>;
};

function rpcHandlers() {
  if (!globalForAvatarRpc.__lifestoryAvatarRpcHandlers) {
    globalForAvatarRpc.__lifestoryAvatarRpcHandlers = new Map();
  }
  return globalForAvatarRpc.__lifestoryAvatarRpcHandlers;
}

function avatarApiKeyForSession(session: { id: string; user_id: string | null }) {
  return getSessionProviderCredentials(db, session).runwayApiKey;
}

function avatarIdFrom(body: AvatarSessionRequest) {
  return process.env.RUNWAY_CHARACTER_AVATAR_ID
    || body.avatarId
    || 'customer-service';
}

async function loadAvatarRpcRuntime() {
  const externalImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
  const [rpcModule, toolsModule] = await Promise.all([
    externalImport<AvatarRpcRuntime>('@runwayml/avatars-node-rpc'),
    import('@/lib/avatar/tools'),
  ]);

  return {
    createRpcHandler: rpcModule.createRpcHandler,
    createAvatarRpcTools: toolsModule.createAvatarRpcTools,
  };
}

function recordRunwayStatus(input: {
  avatarCallSessionId: string;
  sessionId: string;
  runwaySessionId: string;
  eventType: 'runway_status' | 'runway_ready_timeout';
  status: AvatarReadySession | { status: string; failure?: unknown };
  attempt: number;
  elapsedMs: number;
}) {
  recordAvatarCallEvent(db, {
    avatarCallSessionId: input.avatarCallSessionId,
    sessionId: input.sessionId,
    runwaySessionId: input.runwaySessionId,
    eventType: input.eventType,
    payload: {
      status: input.status.status,
      failure: 'failure' in input.status ? input.status.failure : undefined,
      attempt: input.attempt,
      elapsedMs: input.elapsedMs,
    },
  });
}

async function waitForReadySession(
  client: RunwayML,
  runwaySessionId: string,
  context: { avatarCallSessionId: string; sessionId: string },
) {
  const startedAt = Date.now();
  const deadline = Date.now() + AVATAR_SESSION_READY_TIMEOUT_MS;
  let lastStatus = 'UNKNOWN';
  let lastLoggedStatus = 'UNKNOWN';
  let attempt = 0;

  while (Date.now() < deadline) {
    const status = await client.realtimeSessions.retrieve(runwaySessionId);
    attempt += 1;
    lastStatus = status.status;
    const elapsedMs = Date.now() - startedAt;
    avatarDebugLog('runway_session_status', status);

    if (status.status !== lastLoggedStatus || attempt === 1 || attempt % AVATAR_SESSION_STATUS_LOG_EVERY_ATTEMPTS === 0) {
      recordRunwayStatus({
        ...context,
        runwaySessionId,
        eventType: 'runway_status',
        status,
        attempt,
        elapsedMs,
      });
      lastLoggedStatus = status.status;
    }

    if (status.status === 'READY') return status;
    if (status.status === 'FAILED') {
      throw new Error(`Runway avatar session failed: ${status.failure}`);
    }
    if (status.status === 'CANCELLED') {
      throw new Error('Runway avatar session was cancelled.');
    }

    await new Promise((resolve) => setTimeout(resolve, AVATAR_SESSION_READY_POLL_MS));
  }

  recordRunwayStatus({
    ...context,
    runwaySessionId,
    eventType: 'runway_ready_timeout',
    status: { status: lastStatus },
    attempt,
    elapsedMs: Date.now() - startedAt,
  });
  throw new Error(`Runway avatar session ${runwaySessionId} did not become ready within ${Math.round(AVATAR_SESSION_READY_TIMEOUT_MS / 1000)}s. Last status: ${lastStatus}.`);
}

export async function POST(req: NextRequest) {
  let avatarCallSessionId: string | null = null;
  let appSessionId: string | null = null;
  let runwaySessionId: string | null = null;

  try {
    const body = await req.json() as AvatarSessionRequest;
    if (!body.appSessionId) {
      return NextResponse.json({ error: 'appSessionId is required.' }, { status: 400 });
    }

    appSessionId = body.appSessionId;
    const { session } = requireOwnedSessionForRequest(req, appSessionId);
    const apiKey = avatarApiKeyForSession(session);
    if (!apiKey) {
      return NextResponse.json({
        error: 'Add a saved Runway API key before starting a director call. The same key powers Runway video generation and the live character.',
      }, { status: 400 });
    }

    const storyBucket = loadStoryBucket(db, session.id);
    const storyContext = buildStoryContextForAvatar(storyBucket);
    const client = new RunwayML({ apiKey });
    const avatarId = avatarIdFrom(body);

    const realtimeSessionPayload: RealtimeSessionCreateParams = {
      model: 'gwm1_avatars',
      avatar: { type: 'custom', avatarId },
      maxDuration: 300,
      personality: buildAvatarPersonality({ storyContext, userName: session.user_name }),
      startScript: buildAvatarStartScript({ userName: session.user_name }),
      tools: avatarSessionTools as RealtimeSessionCreateParams['tools'],
    };

    const created = await client.realtimeSessions.create(realtimeSessionPayload);

    runwaySessionId = created.id;
    avatarCallSessionId = uuidv4();
    db.prepare(`
      INSERT INTO avatar_call_sessions (id, session_id, runway_session_id, status)
      VALUES (?, ?, ?, ?)
    `).run(avatarCallSessionId, session.id, runwaySessionId, 'PROVISIONING');
    recordAvatarCallEvent(db, {
      avatarCallSessionId,
      sessionId: session.id,
      runwaySessionId,
      eventType: 'session_created',
      payload: {
        runwaySessionId,
        avatarId,
        toolCount: avatarSessionTools.length,
      },
    });

    const ready = await waitForReadySession(client, runwaySessionId, {
      avatarCallSessionId,
      sessionId: session.id,
    });
    db.prepare('UPDATE avatar_call_sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('READY', avatarCallSessionId);

    const credentials = await consumeSession({
      sessionId: runwaySessionId,
      sessionKey: ready.sessionKey,
    });
    recordAvatarCallEvent(db, {
      avatarCallSessionId,
      sessionId: session.id,
      runwaySessionId,
      eventType: 'session_consumed',
      payload: { roomName: credentials.roomName, url: credentials.url },
    });

    const { createRpcHandler, createAvatarRpcTools } = await loadAvatarRpcRuntime();
    const handler = await createRpcHandler({
      apiKey,
      sessionId: runwaySessionId,
      tools: createAvatarRpcTools({
        database: db,
        appSessionId: session.id,
        avatarCallSessionId,
        runwaySessionId,
      }),
      debug: process.env.AVATAR_DEBUG_LOGS === '1',
      onConnected: () => {
        db.prepare(`
          UPDATE avatar_call_sessions
          SET status = ?, started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run('RUNNING', avatarCallSessionId);
        recordAvatarCallEvent(db, {
          avatarCallSessionId,
          sessionId: session.id,
          runwaySessionId,
          eventType: 'rpc_connected',
        });
      },
      onDisconnected: () => {
        db.prepare(`
          UPDATE avatar_call_sessions
          SET status = ?, ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run('DISCONNECTED', avatarCallSessionId);
        recordAvatarCallEvent(db, {
          avatarCallSessionId,
          sessionId: session.id,
          runwaySessionId,
          eventType: 'rpc_disconnected',
        });
        rpcHandlers().delete(runwaySessionId as string);
      },
      onError: (error) => {
        const message = redactAvatarLogValue(error.message);
        db.prepare(`
          UPDATE avatar_call_sessions
          SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run('ERROR', message, avatarCallSessionId);
        recordAvatarCallEvent(db, {
          avatarCallSessionId,
          sessionId: session.id,
          runwaySessionId,
          eventType: 'rpc_error',
          errorMessage: message,
        });
      },
    });

    rpcHandlers().set(runwaySessionId, handler);

    return NextResponse.json({
      sessionId: runwaySessionId,
      serverUrl: credentials.url,
      token: credentials.token,
      roomName: credentials.roomName,
    });
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;

    const message = error instanceof Error ? error.message : String(error);
    if (avatarCallSessionId && appSessionId) {
      db.prepare(`
        UPDATE avatar_call_sessions
        SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run('ERROR', redactAvatarLogValue(message), avatarCallSessionId);
      recordAvatarCallEvent(db, {
        avatarCallSessionId,
        sessionId: appSessionId,
        runwaySessionId,
        eventType: 'session_error',
        errorMessage: message,
      });
    }

    return NextResponse.json({
      error: redactAvatarLogValue(message),
      runwaySessionId,
      avatarCallSessionId,
    }, { status: 500 });
  }
}
