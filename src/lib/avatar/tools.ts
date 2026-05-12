import type Database from 'better-sqlite3';
import type { ToolHandler } from '@runwayml/avatars-node-rpc';
import type { ChatHistoryRow, SceneRow, SessionRow } from '@/lib/types';
import { buildContextualInterviewFollowUp, ensureProactiveDirectorReply } from '@/lib/director-continuation';
import { broadcastSessionUpdate } from '@/lib/sse';
import {
  addReferenceSubject,
  applyProfileBucketUpdate,
  approveFilmTreatment,
  createReferenceUploadRequest,
  getActiveReferenceRequest,
  hasProtagonistReferenceDecision,
  loadStoryBucket,
  lockSceneOutlineForProduction,
  proposeFilmTreatment,
  proposeSceneOutline,
  recordMemorySketch,
  reviseSceneOutline,
  saveReferenceDescription,
  saveSketchFeedback,
} from '@/lib/story-bucket';
import {
  addReferenceSubjectSchema,
  filmTreatmentSchema,
  lockSceneOutlineSchema,
  memorySketchSchema,
  proposeSceneOutlineSchema,
  requestReferenceUploadSchema,
  reviseSceneOutlineSchema,
  saveReferenceDescriptionSchema,
  saveSketchFeedbackSchema,
  updateProfileBucketSchema,
} from '@/lib/ai/tools';
import { avatarDebugLog, recordAvatarCallEvent, redactAvatarLogValue } from './logging';
export { avatarBackendTools, avatarClientTools, avatarSessionTools } from './tool-definitions';

type SqliteDatabase = Database.Database;

function parsePayloadJson<T>(args: Record<string, unknown>, parser: { parse: (value: unknown) => T }) {
  const rawPayload = args.payloadJson;
  if (typeof rawPayload !== 'string') {
    throw new Error('payloadJson must be a JSON string.');
  }
  return parser.parse(JSON.parse(rawPayload));
}

function getSessionScenes(database: SqliteDatabase, sessionId: string): SceneRow[] {
  return database.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
}

function getFullSessionUpdate(database: SqliteDatabase, sessionId: string) {
  return {
    session: database.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow,
    chat_history: database.prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatHistoryRow[],
    scenes: getSessionScenes(database, sessionId),
    story_bucket: loadStoryBucket(database, sessionId),
    active_reference_request: getActiveReferenceRequest(database, sessionId) || null,
  };
}

function broadcastAvatarSessionUpdate(database: SqliteDatabase, sessionId: string) {
  broadcastSessionUpdate(sessionId, getFullSessionUpdate(database, sessionId));
}

function advanceInterviewStatus(database: SqliteDatabase, sessionId: string) {
  const session = database.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  if (!session) return;

  const bucket = loadStoryBucket(database, sessionId);
  if (
    session.status === 'INTERVIEW_ONBOARDING'
    && bucket.profile?.protagonist_name
    && bucket.profile.age
    && bucket.profile.profession
    && bucket.profile.current_location
  ) {
    database.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('INTERVIEW_PSYCH_PROFILE', sessionId);
    return;
  }

  if (session.status === 'INTERVIEW_PSYCH_PROFILE' && (bucket.timelineEvents.length >= 3 || bucket.memoryCandidates.length >= 2)) {
    database.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('INTERVIEW_DYNAMIC', sessionId);
  }
}

function directorReplyFrom(value: unknown, fallback: string) {
  const fallbackQuestion = /[?？]/.test(fallback)
    ? fallback
    : 'Which earlier or later chapter would help explain who you are now?';
  if (!value || typeof value !== 'object') {
    return ensureProactiveDirectorReply(fallback, { fallbackQuestion });
  }
  const reply = (value as { directorReply?: unknown }).directorReply;
  return ensureProactiveDirectorReply(typeof reply === 'string' && reply.trim() ? reply : fallback, { fallbackQuestion });
}

function avatarProfileFallbackQuestion(database: SqliteDatabase, sessionId: string) {
  const bucket = loadStoryBucket(database, sessionId);
  const profile = bucket.profile;

  if (!profile?.protagonist_name) {
    return 'What should I call you, and how old are you?';
  }
  if (!profile.age) {
    return `Lovely to meet you, ${profile.protagonist_name}. How old are you?`;
  }
  if (!profile.current_location && !profile.profession) {
    return 'Beautiful. Where do you live now, and what work fills your days?';
  }
  if (!profile.current_location) {
    return 'Where are you living now?';
  }
  if (!profile.profession) {
    return 'And what do you do these days?';
  }
  if (bucket.timelineEvents.length === 0 && bucket.memoryCandidates.length === 0) {
    return 'Give me the short version of the path that led you here in life.';
  }
  if (bucket.timelineEvents.length < 2) {
    return 'What early chapter, maybe childhood or school, still feels important to who you became?';
  }
  if (bucket.timelineEvents.length < 4) {
    return 'Which later chapter changed the direction of your life?';
  }
  if (bucket.memoryCandidates.length < 2) {
    return 'What is one specific moment from all of that that still plays like a scene in your mind?';
  }

  return 'Is there a relationship, turning point, or memory we have not touched yet that belongs in the film?';
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return redactAvatarLogValue(error.message);
  return 'The director tool failed.';
}

type CreateAvatarRpcToolsInput = {
  database: SqliteDatabase;
  appSessionId: string;
  avatarCallSessionId: string;
  runwaySessionId: string;
  productionRunner?: (sessionId: string, options: { database: SqliteDatabase }) => Promise<unknown>;
};

const AVATAR_RENDER_HANDOFF_REPLY = "All right, we'll wrap it up here. Add your email and I'll message you once your movie is ready!";
const avatarSceneOutlinePayloadSchema = proposeSceneOutlineSchema.extend({
  treatment: filmTreatmentSchema.optional(),
});

async function defaultProductionRunner(sessionId: string, options: { database: SqliteDatabase }) {
  const { runAutomaticProductionPipeline } = await import('@/lib/pipeline_media');
  return runAutomaticProductionPipeline(sessionId, { database: options.database });
}

export function createAvatarRpcTools(input: CreateAvatarRpcToolsInput): Record<string, ToolHandler> {
  const { database, appSessionId, avatarCallSessionId, runwaySessionId } = input;
  const productionRunner = input.productionRunner || defaultProductionRunner;

  function startAutomaticProduction(toolName: string) {
    productionRunner(appSessionId, { database }).catch((error) => {
      recordAvatarCallEvent(database, {
        avatarCallSessionId,
        sessionId: appSessionId,
        runwaySessionId,
        eventType: 'production_queue_error',
        toolName,
        errorMessage: safeErrorMessage(error),
      });
    });
  }

  async function runTool(
    toolName: string,
    args: Record<string, unknown>,
    action: () => Promise<Record<string, unknown>> | Record<string, unknown>,
  ) {
    const startedAt = Date.now();
    avatarDebugLog(`tool_start:${toolName}`, args);
    recordAvatarCallEvent(database, {
      avatarCallSessionId,
      sessionId: appSessionId,
      runwaySessionId,
      eventType: 'tool_start',
      toolName,
      payload: args,
    });

    try {
      const result = await action();
      const durationMs = Date.now() - startedAt;
      recordAvatarCallEvent(database, {
        avatarCallSessionId,
        sessionId: appSessionId,
        runwaySessionId,
        eventType: 'tool_result',
        toolName,
        durationMs,
        payload: result,
      });
      avatarDebugLog(`tool_result:${toolName}`, result);
      broadcastAvatarSessionUpdate(database, appSessionId);
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = safeErrorMessage(error);
      recordAvatarCallEvent(database, {
        avatarCallSessionId,
        sessionId: appSessionId,
        runwaySessionId,
        eventType: 'tool_error',
        toolName,
        durationMs,
        payload: args,
        errorMessage: message,
      });
      avatarDebugLog(`tool_error:${toolName}`, message);
      broadcastAvatarSessionUpdate(database, appSessionId);
      return { ok: false, error: message };
    }
  }

  return {
    update_profile_bucket: (args) => runTool('update_profile_bucket', args, () => {
      const payload = parsePayloadJson(args, updateProfileBucketSchema);
      applyProfileBucketUpdate(database, appSessionId, payload);
      advanceInterviewStatus(database, appSessionId);
      return {
        ok: true,
        directorReply: directorReplyFrom(payload, avatarProfileFallbackQuestion(database, appSessionId)),
      };
    }),
    request_reference_upload: (args) => runTool('request_reference_upload', args, () => {
      const payload = requestReferenceUploadSchema.parse(args);
      const request = createReferenceUploadRequest(database, appSessionId, payload);
      if (!request && payload.targetType === 'protagonist' && payload.referenceScope !== 'scene' && hasProtagonistReferenceDecision(database, appSessionId)) {
        return {
          ok: true,
          alreadyHandled: true,
          requestId: null,
          directorReply: 'I have your photo, thank you. Give me the short version of the path that led you here in life.',
        };
      }
      return {
        ok: true,
        requestId: request?.id || null,
        directorReply: payload.promptText,
        layout: 'upload',
      };
    }),
    add_reference_subject: (args) => runTool('add_reference_subject', args, () => {
      const payload = parsePayloadJson(args, addReferenceSubjectSchema);
      const result = addReferenceSubject(database, appSessionId, payload);
      return {
        ok: true,
        entityId: result.entity.id,
        referenceAssetId: result.referenceAsset.id,
        directorReply: directorReplyFrom(payload, buildContextualInterviewFollowUp(loadStoryBucket(database, appSessionId))),
      };
    }),
    save_reference_description: (args) => runTool('save_reference_description', args, () => {
      const payload = parsePayloadJson(args, saveReferenceDescriptionSchema);
      const referenceAsset = saveReferenceDescription(database, appSessionId, payload);
      return {
        ok: true,
        referenceAssetId: referenceAsset.id,
        directorReply: directorReplyFrom(payload, 'Got it. I saved those visual details.'),
      };
    }),
    record_memory_sketch: (args) => runTool('record_memory_sketch', args, () => {
      const payload = parsePayloadJson(args, memorySketchSchema);
      const candidate = recordMemorySketch(database, appSessionId, {
        candidateId: payload.candidateId,
        title: payload.title,
        description: payload.description,
        visualPrompt: payload.visualPrompt,
        sketchUrl: null,
      });
      return {
        ok: true,
        candidateId: candidate.id,
        directorReply: payload.chatMessage || 'I saved that as a visual memory direction.',
      };
    }),
    save_sketch_feedback: (args) => runTool('save_sketch_feedback', args, () => {
      const payload = parsePayloadJson(args, saveSketchFeedbackSchema);
      const candidate = saveSketchFeedback(database, appSessionId, payload);
      return {
        ok: true,
        candidateId: candidate?.id || payload.candidateId,
        directorReply: directorReplyFrom(payload, 'Noted. I will fold that into the cut.'),
      };
    }),
    propose_film_treatment: (args) => runTool('propose_film_treatment', args, () => {
      const payload = parsePayloadJson(args, filmTreatmentSchema);
      const treatment = proposeFilmTreatment(database, appSessionId, payload);
      return {
        ok: true,
        treatmentId: treatment.id,
        directorReply: ensureProactiveDirectorReply(
          typeof payload.directorReply === 'string' ? payload.directorReply : 'I put the film treatment on the page.',
          { fallbackQuestion: 'Does this feel true enough to turn into scenes?' },
        ),
        layout: 'review',
      };
    }),
    propose_scene_outline: (args) => runTool('propose_scene_outline', args, () => {
      const payload = parsePayloadJson(args, avatarSceneOutlinePayloadSchema);
      const existingTreatment = loadStoryBucket(database, appSessionId).treatment;
      if (!existingTreatment && payload.treatment) {
        proposeFilmTreatment(database, appSessionId, payload.treatment);
      }
      approveFilmTreatment(database, appSessionId);
      const outline = proposeSceneOutline(database, appSessionId, payload);
      const result = lockSceneOutlineForProduction(database, appSessionId);
      startAutomaticProduction('propose_scene_outline');
      return {
        ok: true,
        sceneCount: outline.length,
        createdScenes: result.createdScenes,
        endCall: true,
        directorReply: AVATAR_RENDER_HANDOFF_REPLY,
        layout: 'email',
      };
    }),
    revise_scene_outline: (args) => runTool('revise_scene_outline', args, () => {
      const payload = parsePayloadJson(args, reviseSceneOutlineSchema);
      const scene = reviseSceneOutline(database, appSessionId, payload);
      return {
        ok: true,
        sceneOutlineId: scene?.id || payload.sceneOutlineId || null,
        directorReply: directorReplyFrom(payload, 'I revised that scene. Have a look.'),
      };
    }),
    lock_scene_outline: (args) => runTool('lock_scene_outline', args, () => {
      lockSceneOutlineSchema.parse(args);
      const result = lockSceneOutlineForProduction(database, appSessionId);
      startAutomaticProduction('lock_scene_outline');
      return {
        ok: true,
        endCall: true,
        createdScenes: result.createdScenes,
        directorReply: 'Perfect. I am sending this into production now. The studio will take it from here, and the page will show the progress.',
      };
    }),
  };
}
