import db from './db';
import { broadcastSessionUpdate } from './sse';
import { generateText, streamText } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import { logConversationEvent } from './conversation-logs';
import { releaseInterviewTurn, tryAcquireInterviewTurn } from './interview-turns';
import { runAutomaticProductionPipeline } from './pipeline_media';
import type { ChatHistoryRow, InterviewMessage, ReferenceUploadRequestRow, SceneRow, SessionRow, StoryBucket, UserUploadRow } from './types';
import {
  buildDirectorContinuationPrompt,
  extractAssistantQuestions,
  safeDirectorOutageContinuation,
  validateDirectorContinuation,
} from './director-continuation';
import { filmTreatmentReviewHandoff } from './treatment-reply';
import { sceneOutlineFieldContract, storySceneDiversityPrompt } from './ai/prompts/scene-outline';
import {
  aiTools,
  addReferenceSubjectSchema,
  filmTreatmentSchema,
  getToolCall,
  lockSceneOutlineSchema,
  memorySketchSchema,
  requestReferenceUploadSchema,
  reviseSceneOutlineSchema,
  saveReferenceDescriptionSchema,
  saveSketchFeedbackSchema,
  updateProfileBucketSchema,
} from './ai/tools';
import { buildInterviewSystemPrompt } from './ai/prompts';
import { generateImageAsset, imageRatio } from './runway';
import { SKETCH_IMAGE_QUALITY } from './production-config';
import { evaluateLifeStoryOutlineReadiness } from './story-readiness';
import { canUseAsset } from './production-references';
import { parseProposeSceneOutlineText, parseProposeSceneOutlineToolInput } from './scene-outline-tool-input';
import {
  MISSING_BYOK_MESSAGE,
  createRunwayClientForSession,
  isMissingUserCredentialError,
  openRouterModelForSession,
} from './providers/user-credentials';
import {
  addReferenceSubject,
  applyProfileBucketUpdate,
  approveFilmTreatment,
  createReferenceAsset,
  createReferenceUploadRequest,
  getActiveReferenceRequest,
  hasProtagonistReferenceDecision,
  loadStoryBucket,
  lockSceneOutlineForProduction,
  maybeCreateSupportingReferenceUploadRequest,
  proposeFilmTreatment,
  proposeSceneOutline,
  recordMemorySketch,
  reviseSceneOutline,
  saveReferenceDescription,
  saveSketchFeedback,
} from './story-bucket';

const MAX_DIRECTOR_OUTLINE_OUTPUT_TOKENS = 8192;
const MAX_DIRECTOR_CONTINUATION_OUTPUT_TOKENS = 1200;
const MAX_DIRECTOR_TOOL_OUTPUT_TOKENS = 8192;

function safeInterviewErrorMessage(error: unknown) {
  if (isMissingUserCredentialError(error)) return MISSING_BYOK_MESSAGE;
  return 'Generation failed. Please try again.';
}

function getSessionScenes(sessionId: string): SceneRow[] {
  return db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
}

function formatJsonList(value: string | null | undefined) {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return '';
    return parsed.join(', ');
  } catch {
    return '';
  }
}

export function formatStoryBucketForPrompt(bucket: StoryBucket) {
  const parts: string[] = [];

  if (bucket.profile) {
    const profileBits = [
      bucket.profile.protagonist_name ? `name: ${bucket.profile.protagonist_name}` : '',
      bucket.profile.age ? `age: ${bucket.profile.age}` : '',
      bucket.profile.profession ? `profession: ${bucket.profile.profession}` : '',
      bucket.profile.current_location ? `current place: ${bucket.profile.current_location}` : '',
      bucket.profile.life_phase ? `phase: ${bucket.profile.life_phase}` : '',
      bucket.profile.emotional_tone ? `tone: ${bucket.profile.emotional_tone}` : '',
      bucket.profile.summary ? `summary: ${bucket.profile.summary}` : '',
      formatJsonList(bucket.profile.themes_json) ? `themes: ${formatJsonList(bucket.profile.themes_json)}` : '',
    ].filter(Boolean).join('; ');
    if (profileBits) parts.push(`Profile: ${profileBits}`);
  }

  if (bucket.treatment) {
    parts.push(`Film treatment: ${bucket.treatment.title}; thesis: ${bucket.treatment.emotional_thesis}; arc: ${bucket.treatment.narrative_arc}; motif: ${bucket.treatment.visual_motif}; narrator style: ${bucket.treatment.narrator_style}; ending: ${bucket.treatment.ending_feeling}`);
  }

  if (bucket.entities.length) {
    parts.push(`Entities: ${bucket.entities.map((entity) => `${entity.display_name} (${entity.type}${entity.relationship ? `, ${entity.relationship}` : ''})`).join('; ')}`);
  }

  if (bucket.timelineEvents.length) {
    parts.push(`Timeline: ${bucket.timelineEvents.map((event) => `${event.label}: ${event.description}`).join('; ')}`);
  }

  if (bucket.memoryCandidates.length) {
    parts.push(`Candidate scenes: ${bucket.memoryCandidates.map((candidate) => `id=${candidate.id}; ${candidate.title}: ${candidate.description}`).join('; ')}`);
  }

  if (bucket.referenceAssets.length) {
    const usableReferences = bucket.referenceAssets.filter((asset) => canUseAsset(asset));
    const descriptionOnlyReferences = bucket.referenceAssets.filter((asset) => !canUseAsset(asset));

    if (usableReferences.length) {
      parts.push(`References usable for generation: ${usableReferences.map((asset) => `@${asset.stable_tag}${asset.vision_description ? ` (${asset.vision_description})` : ''}`).join('; ')}`);
    }

    if (descriptionOnlyReferences.length) {
      parts.push(`Description-only references, not usable as generation @tags: ${descriptionOnlyReferences.map((asset) => `@${asset.stable_tag}${asset.vision_description ? ` (${asset.vision_description})` : ''}`).join('; ')}`);
    }
  }

  if (bucket.sceneOutline.length) {
    parts.push(`Current outline: ${bucket.sceneOutline.map((scene) => `${scene.scene_index + 1}. ${scene.title}: ${scene.summary}`).join('; ')}`);
  }

  return parts.join('\n');
}

function advanceInterviewStatus(session: SessionRow, bucket: StoryBucket) {
  if (session.status === 'INTERVIEW_ONBOARDING') {
    if (
      bucket.profile?.protagonist_name
      && bucket.profile?.age
      && bucket.profile?.profession
      && bucket.profile?.current_location
    ) {
      db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('INTERVIEW_PSYCH_PROFILE', session.id);
      return;
    }
  }

  if (session.status === 'INTERVIEW_PSYCH_PROFILE' && (bucket.timelineEvents.length >= 3 || bucket.memoryCandidates.length >= 2)) {
    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('INTERVIEW_DYNAMIC', session.id);
  }
}

function getFullSessionUpdate(sessionId: string) {
  return {
    session: db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow,
    chat_history: db.prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatHistoryRow[],
    scenes: getSessionScenes(sessionId),
    story_bucket: loadStoryBucket(db, sessionId),
    active_reference_request: getActiveReferenceRequest(db, sessionId) || null,
  };
}

function protagonistReferencePrompt(session: SessionRow) {
  const name = session.user_name || 'you';
  return `If you are comfortable with it, you can add a selfie now so I can keep ${name} visually consistent in the film. Drop a photo into the upload box, describe yourself instead, or skip it.`;
}

function hasBasicLifeStoryProfile(bucket: StoryBucket) {
  return Boolean(
    bucket.profile?.protagonist_name
    && bucket.profile?.age
    && bucket.profile?.profession
    && bucket.profile?.current_location,
  );
}

function hasLifePathContext(bucket: StoryBucket) {
  return Boolean(
    bucket.timelineEvents.length > 0
    || bucket.memoryCandidates.length > 0
    || (bucket.profile?.summary && bucket.profile.summary.length > 40),
  );
}

function latestUserText(messages: InterviewMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content || '';
}

function hasUnassignedUploadedReference(sessionId: string) {
  const row = db.prepare(`
    SELECT 1 FROM reference_assets
    WHERE session_id = ?
      AND owner_entity_id IS NULL
      AND usage_permissions = 'allowed'
      AND (local_url IS NOT NULL OR runway_uri IS NOT NULL)
    LIMIT 1
  `).get(sessionId);
  return Boolean(row);
}

function shouldBlockReferenceTool(sessionId: string, toolName: string) {
  const activeReferenceRequest = getActiveReferenceRequest(db, sessionId);
  if (activeReferenceRequest && !['update_profile_bucket', 'add_reference_subject', 'save_reference_description'].includes(toolName)) {
    return true;
  }

  if (toolName === 'add_reference_subject') {
    return !hasUnassignedUploadedReference(sessionId);
  }

  if (toolName === 'save_reference_description') {
    return !activeReferenceRequest;
  }

  return false;
}

export function isTreatmentApprovalForOutline(message: string, bucket: StoryBucket) {
  if (!bucket.treatment || bucket.sceneOutline.length > 0) return false;

  const text = message.trim();
  if (!text) return false;
  if (/\b(?:but|however|change|revise|revision|add|remove|instead|maybe|perhaps|not yet|wait)\b/i.test(text)) {
    return false;
  }

  return /\b(?:approve|approved|accept|accepted|yes|sure|ok|okay|go ahead|implement|draft|outline|scenes?|move on|looks good|like it)\b/i.test(text);
}

export function isMovieCreationRequest(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (/\b(?:but|however|change|revise|revision|add|remove|instead|maybe|perhaps|not yet|wait)\b/i.test(text)) {
    return false;
  }

  const saysNothingElse = /\b(?:no|nothing|that's it|thats it|all good|enough)\b/i.test(text);
  const asksToCreate = /\b(?:create|make|generate|start|go ahead|move on|proceed|continue|finish)\b[\s\S]{0,36}\b(?:movie|film|video|cut|plan|outline|scenes?)\b/i.test(text)
    || /\b(?:movie|film|video|cut|plan|outline|scenes?)\b[\s\S]{0,36}\b(?:create|make|generate|start|go ahead|move on|proceed|continue|finish)\b/i.test(text);

  return saysNothingElse || asksToCreate;
}

function compactText(value: string | null | undefined, fallback: string) {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function shortenForNarration(value: string, fallback: string) {
  const text = compactText(value, fallback);
  return text.length > 136 ? `${text.slice(0, 133).trim()}...` : text;
}

function stripInternalPurposeLanguage(value: string | null | undefined) {
  return compactText(value, '')
    .replace(/^(?:to show|to establish|establishing|highlighting|highlight|representing|represent|showing)\b[:,\s-]*/i, '')
    .replace(/^(?:this scene|the scene|this moment)\s+(?:shows|demonstrates|establishes|highlights|represents)\b[:,\s-]*/i, '')
    .replace(/^(?:the purpose is|its purpose is|purpose)\s+to\b[:,\s-]*/i, '')
    .trim();
}

function isInternalPurposeLine(value: string) {
  return /^(?:to show|to establish|establishing|highlighting|highlight|representing|represent|showing)\b/i.test(value)
    || /\b(?:emotional thesis|visual motif|narrative arc)\b/i.test(value);
}

function firstSentence(value: string) {
  const match = value.match(/^[\s\S]*?(?:[.!?](?=\s|$)|$)/);
  return (match?.[0] || value).trim();
}

function fallbackNarratorText(seed: { title: string; summary: string; visualSummary: string }) {
  const haystack = `${seed.title} ${seed.summary} ${seed.visualSummary}`.toLowerCase();

  if (/\b(interstellar|black hole|singularity|cinema|movie)\b/.test(haystack)) {
    return 'In the dark of a cinema, the unknown suddenly felt close enough to follow.';
  }
  if (/\b(laptop|computer|gaming|games|technology)\b/.test(haystack)) {
    return 'A first laptop opened a private universe of games, machines, and discovery.';
  }
  if (/\b(kayak|albania|drin|river|blue eye|storm|ocean rescue)\b/.test(haystack)) {
    return 'In Albania, the water turned adventure into survival, and fear into forward motion.';
  }
  if (/\b(trance|festival|dance floor|sound system|psytrance)\b/.test(haystack)) {
    return 'At the festival, sound and light opened a new world before explanation could catch up.';
  }
  if (/\b(lenos|philosophy|equations?|physics|whiteboard|kitchen)\b/.test(haystack)) {
    return 'With Lenos, physics left the page and became a long conversation about reality itself.';
  }

  const candidates = [seed.summary, seed.visualSummary, seed.title]
    .map((candidate) => firstSentence(stripInternalPurposeLanguage(candidate)))
    .filter((candidate) => candidate && !isInternalPurposeLine(candidate));
  const cleanLine = candidates[0] || seed.title;
  return shortenForNarration(cleanLine, seed.title);
}

function sceneOutlineLogScenes(scenes: Array<{
  title: string;
  summary: string;
  narratorText: string;
  duration: number;
  emotionalPurpose?: string;
}>) {
  return scenes.map((scene, index) => ({
    index,
    title: scene.title,
    summary: scene.summary,
    narratorText: scene.narratorText,
    duration: scene.duration,
    emotionalPurpose: scene.emotionalPurpose || null,
  }));
}

export function buildFallbackSceneOutlineFromBucket(bucket: StoryBucket) {
  const treatment = bucket.treatment;
  const motif = treatment?.visual_motif || 'cinematic light and movement';
  const seeds = bucket.memoryCandidates.length
    ? bucket.memoryCandidates.map((candidate) => ({
      title: candidate.title,
      summary: compactText(candidate.description, candidate.title),
      emotionalPurpose: compactText(candidate.emotional_purpose, treatment?.emotional_thesis || 'A meaningful life-story beat.'),
      visualSummary: compactText(candidate.visual_summary, candidate.description),
    }))
    : bucket.timelineEvents.map((event) => ({
      title: event.label,
      summary: compactText(event.description, event.label),
      emotionalPurpose: compactText(event.emotion, treatment?.emotional_thesis || 'A meaningful life-story beat.'),
      visualSummary: compactText(event.description, event.label),
    }));

  const usableSeeds = seeds.length ? seeds.slice(0, 6) : [{
    title: treatment?.title || 'The Life Story',
    summary: treatment?.narrative_arc || treatment?.emotional_thesis || 'A concise emotional life-story arc.',
    emotionalPurpose: treatment?.emotional_thesis || 'The emotional truth of the film.',
    visualSummary: treatment?.visual_motif || 'A cinematic symbolic scene.',
  }];

  return {
    scenes: usableSeeds.map((seed) => ({
      title: seed.title,
      summary: seed.summary,
      narratorText: fallbackNarratorText(seed),
      imagePrompt: `Cinematic life-story frame: ${seed.visualSummary}. Visual motif: ${motif}.`,
      videoPrompt: `The camera slowly moves through the scene as ${seed.visualSummary} unfolds with subtle motion and changing light.`,
      duration: 8,
      emotionalPurpose: seed.emotionalPurpose,
      referenceNeeds: [],
      protagonistVisible: true,
    })),
    directorReply: 'I drafted the scene outline below. Review the scenes and approve them when they feel right, or leave notes for changes.',
  };
}

export function buildTreatmentApprovedOutlineDraftPrompt(bucket: StoryBucket) {
  return [
    'Create a concise reviewable LifeStory scene outline from this approved film treatment and private story bucket.',
    'Each scene must be cinematic, emotionally specific, and ready for image/video generation.',
    'Return only JSON. Do not wrap it in prose unless you must; if wrapped, the JSON object must still be complete.',
    sceneOutlineFieldContract,
    'Keep narratorText short and within the duration word budget.',
    storySceneDiversityPrompt,
    formatStoryBucketForPrompt(bucket),
  ].join('\n\n');
}

function sceneOutlineToolInputSummary(input: unknown) {
  const scenes = input && typeof input === 'object' && Array.isArray((input as { scenes?: unknown }).scenes)
    ? (input as { scenes: unknown[] }).scenes
    : [];

  return {
    sceneCount: scenes.length,
    titledScenes: scenes.filter((scene) => (
      scene
      && typeof scene === 'object'
      && typeof (scene as { title?: unknown }).title === 'string'
      && Boolean((scene as { title: string }).title.trim())
    )).length,
    summarizedScenes: scenes.filter((scene) => (
      scene
      && typeof scene === 'object'
      && typeof (scene as { summary?: unknown }).summary === 'string'
      && Boolean((scene as { summary: string }).summary.trim())
    )).length,
  };
}

function sceneOutlineTitles(scenes: { title: string }[]) {
  return scenes.map((scene) => scene.title);
}

async function draftSceneOutlineAfterTreatmentApproval(sessionId: string) {
  const bucket = loadStoryBucket(db, sessionId);
  const prompt = buildTreatmentApprovedOutlineDraftPrompt(bucket);

  logConversationEvent({
    sessionId,
    event: 'scene_outline_draft_started',
    metadata: {
      source: 'treatment_approval',
      treatmentId: bucket.treatment?.id || null,
      candidateCount: bucket.memoryCandidates.length,
      timelineEventCount: bucket.timelineEvents.length,
    },
  });

  try {
    const { text } = await generateText({
      model: openRouterModelForSession(db, sessionId, 'google/gemini-3.1-flash-lite'),
      maxOutputTokens: MAX_DIRECTOR_OUTLINE_OUTPUT_TOKENS,
      system: 'You are a film outline drafter. Create production-ready scenes from an approved treatment. Return a single valid JSON object matching the scene outline field contract. Do not ask more interview questions.',
      prompt,
    });
    const parsedOutline = parseProposeSceneOutlineText(text);
    logConversationEvent({
      sessionId,
      event: 'scene_outline_draft_generated',
      role: 'assistant',
      content: text,
      metadata: {
        source: 'ai_text_draft',
        parseSuccess: parsedOutline.success,
        normalized: parsedOutline.normalized,
        issues: parsedOutline.issues,
      },
    });
    if (!parsedOutline.success) {
      throw new Error(`AI outline text could not be parsed: ${parsedOutline.issues.join('; ')}`);
    }

    const object = parsedOutline.data;
    proposeSceneOutline(db, sessionId, object);
    approveFilmTreatment(db, sessionId);
    logConversationEvent({
      sessionId,
      event: 'scene_outline_persisted',
      metadata: {
        source: 'ai_text_draft',
        sceneCount: object.scenes.length,
        titles: sceneOutlineTitles(object.scenes),
        scenes: sceneOutlineLogScenes(object.scenes),
      },
    });
    return object;
  } catch (error) {
    if (!isMissingUserCredentialError(error)) {
      console.warn('AI outline fallback failed; using deterministic treatment outline.', error);
    }
    logConversationEvent({
      sessionId,
      event: 'scene_outline_draft_error',
      metadata: {
        source: 'ai_text_draft',
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const outline = buildFallbackSceneOutlineFromBucket(bucket);
  logConversationEvent({
    sessionId,
    event: 'scene_outline_fallback_draft',
    metadata: {
      source: 'deterministic_fallback',
      sceneCount: outline.scenes.length,
      titles: sceneOutlineTitles(outline.scenes),
      scenes: sceneOutlineLogScenes(outline.scenes),
    },
  });
  proposeSceneOutline(db, sessionId, outline);
  approveFilmTreatment(db, sessionId);
  logConversationEvent({
    sessionId,
    event: 'scene_outline_persisted',
    metadata: {
      source: 'deterministic_fallback',
      sceneCount: outline.scenes.length,
      titles: sceneOutlineTitles(outline.scenes),
      scenes: sceneOutlineLogScenes(outline.scenes),
    },
  });
  return outline;
}

function maybeRequestLifeStorySelfie(session: SessionRow, bucket: StoryBucket) {
  if (!hasBasicLifeStoryProfile(bucket) || !hasLifePathContext(bucket)) return null;
  if (hasProtagonistReferenceDecision(db, session.id)) return null;

  const active = getActiveReferenceRequest(db, session.id);
  if (active?.target_type === 'protagonist' && active.reference_scope !== 'scene') {
    return active.prompt_text;
  }

  const promptText = protagonistReferencePrompt(session);
  const request = createReferenceUploadRequest(db, session.id, {
    targetType: 'protagonist',
    targetLabel: session.user_name || bucket.profile?.protagonist_name || 'you',
    promptText,
    reason: 'This helps keep you visually consistent in generated scenes, but it is optional.',
    fallbackPrompt: 'No problem if you would rather not upload one. You can describe how you should appear instead.',
  });

  return request ? promptText : null;
}

function latestNarrativeUserText(messages: InterviewMessage[]) {
  return [...messages].reverse().find((message) => (
    message.role === 'user'
    && message.content.trim()
    && !/^\[(?:Image|Sketch):/i.test(message.content.trim())
  ))?.content || '';
}

function referenceRequestSummary(request: ReferenceUploadRequestRow | null | undefined) {
  if (!request) return 'No active optional image request.';

  const scope = request.reference_scope === 'scene' && request.scene_title
    ? `scene-specific for "${request.scene_title}"`
    : 'general';
  return [
    `Active ${scope} reference request for ${request.target_label} (${request.target_type}).`,
    'This must resolve through upload, skip, or description before unrelated reference tools are used.',
    `Prompt shown to user: ${request.prompt_text}`,
  ].join(' ');
}

type DirectorContinuationOptions = {
  activeReferenceRequest?: ReferenceUploadRequestRow | null;
  retryReasons?: string[];
  latestUserMessage?: string;
  protagonistReferenceHandled?: boolean;
};

async function generateDirectorContinuation(
  sessionId: string,
  messages: InterviewMessage[],
  options: DirectorContinuationOptions = {},
) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow;
  const bucket = loadStoryBucket(db, sessionId);
  const recentMessages = messages.slice(-10);
  const recentQuestions = extractAssistantQuestions(recentMessages);
  const latestUserMessage = options.latestUserMessage ?? latestNarrativeUserText(messages);
  const protagonistReferenceHandled = options.protagonistReferenceHandled ?? hasProtagonistReferenceDecision(db, sessionId);
  const activeReferenceRequest = options.activeReferenceRequest ?? (getActiveReferenceRequest(db, sessionId) || null);
  let retryReasons = options.retryReasons || [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = buildDirectorContinuationPrompt({
      status: session.status,
      storyContext: formatStoryBucketForPrompt(bucket),
      latestUserMessage,
      recentMessages,
      recentQuestions,
      activeReferenceRequestSummary: referenceRequestSummary(activeReferenceRequest),
      retryReasons,
    });

    logConversationEvent({
      sessionId,
      event: 'director_continuation_prompt',
      role: 'system',
      content: prompt,
      metadata: {
        attempt,
        recentQuestions,
        activeReferenceRequestId: activeReferenceRequest?.id || null,
      },
    });

    try {
      const { text: generatedText } = await generateText({
        model: openRouterModelForSession(db, session, 'google/gemini-3.1-flash-lite'),
        maxOutputTokens: MAX_DIRECTOR_CONTINUATION_OUTPUT_TOKENS,
        system: prompt,
        messages: recentMessages,
        toolChoice: 'none',
      });

      const reply = generatedText.trim();
      const validation = validateDirectorContinuation({
        reply,
        recentQuestions,
        protagonistReferenceHandled,
      });

      logConversationEvent({
        sessionId,
        event: 'director_continuation_generated',
        role: 'assistant',
        content: reply,
        metadata: {
          attempt,
          valid: validation.valid,
          reasons: validation.reasons,
        },
      });

      if (validation.valid) return reply;
      retryReasons = validation.reasons;
    } catch (error) {
      if (isMissingUserCredentialError(error)) throw error;

      retryReasons = [
        `Continuation generation failed: ${error instanceof Error ? error.message : String(error)}`,
      ];
      logConversationEvent({
        sessionId,
        event: 'director_continuation_error',
        metadata: {
          attempt,
          reasons: retryReasons,
        },
      });
    }
  }

  const fallback = safeDirectorOutageContinuation(latestUserMessage);
  logConversationEvent({
    sessionId,
    event: 'director_continuation_outage_fallback',
    role: 'assistant',
    content: fallback,
    metadata: { retryReasons },
  });
  return fallback;
}

async function chooseDirectorReplyOrContinuation(input: {
  sessionId: string;
  messages: InterviewMessage[];
  streamedText?: string | null;
  text?: string | null;
  directorReply?: string | null;
  chatMessage?: string | null;
  activeReferenceRequest?: ReferenceUploadRequestRow | null;
  retryReasons?: string[];
}) {
  const recentMessages = input.messages.slice(-10);
  const recentQuestions = extractAssistantQuestions(recentMessages);
  const protagonistReferenceHandled = hasProtagonistReferenceDecision(db, input.sessionId);
  const rejectionReasons: string[] = [];
  const candidates = [
    input.streamedText || input.text || '',
    input.directorReply || '',
    input.chatMessage || '',
  ];

  for (const candidate of candidates) {
    const reply = candidate.trim();
    if (!reply) continue;

    const validation = validateDirectorContinuation({
      reply,
      recentQuestions,
      protagonistReferenceHandled,
    });
    if (validation.valid) return reply;
    rejectionReasons.push(...validation.reasons);
  }

  return generateDirectorContinuation(input.sessionId, input.messages, {
    activeReferenceRequest: input.activeReferenceRequest,
    protagonistReferenceHandled,
    retryReasons: [
      ...(input.retryReasons || []),
      ...rejectionReasons,
    ],
  });
}

export async function processInterviewTurn(sessionId: string, options: { turnToken?: string } = {}) {
  const turnToken = options.turnToken || tryAcquireInterviewTurn(db, sessionId);
  if (!turnToken) {
    return { processed: false, busy: true };
  }

  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const directorModel = openRouterModelForSession(db, session, 'google/gemini-3.1-flash-lite');

    const historyRows = db.prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatHistoryRow[];
    const messages: InterviewMessage[] = historyRows.map((row) => ({
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: row.content,
    }));
    const uploads = db.prepare('SELECT file_path, vision_description FROM user_uploads WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Pick<UserUploadRow, 'file_path' | 'vision_description'>[];
    const uploadContext = uploads
      .filter((upload) => upload.vision_description)
      .map((upload, index) => `Reference ${index + 1} (${upload.file_path}): ${upload.vision_description}`)
      .join('\n');

    const storyBucket = loadStoryBucket(db, sessionId);
    const latestUserMessage = latestUserText(messages);
    const treatmentApprovalRequested = isTreatmentApprovalForOutline(latestUserMessage, storyBucket);
    const movieCreationRequested = isMovieCreationRequest(latestUserMessage);
    const activeReferenceRequest = getActiveReferenceRequest(db, sessionId) || null;
    logConversationEvent({
      sessionId,
      event: 'interview_turn_started',
      metadata: {
        status: session.status,
        messageCount: historyRows.length,
        activeReferenceRequestId: activeReferenceRequest?.id || null,
      },
    });
    const systemPrompt = buildInterviewSystemPrompt({
      status: session.status,
      storyContext: formatStoryBucketForPrompt(storyBucket),
      uploadContext,
      activeReferenceRequest,
    });

    const assistantMessageId = uuidv4();
    let text = '';
    
    // Broadcast a placeholder message that will be streamed into
    broadcastSessionUpdate(sessionId, {
      chat_history: [
        ...historyRows,
        {
          id: assistantMessageId,
          session_id: sessionId,
          role: 'assistant',
          content: '',
          options: null,
          created_at: new Date().toISOString()
        }
      ]
    });

    const result = await streamText({
      model: directorModel,
      maxOutputTokens: MAX_DIRECTOR_TOOL_OUTPUT_TOKENS,
      system: systemPrompt,
      messages,
      tools: aiTools,
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          text += chunk.text;
          // Emit just the chunk to append
          broadcastSessionUpdate(sessionId, {
            chat_chunk: {
               id: assistantMessageId,
               text: chunk.text
            }
          });
        }
      }
    });

    // Wait for the full result to get tool calls
    const toolCalls = await result.toolCalls || [];
    text = await result.text || text;

    let finalReply = text;
    let blockedReferenceTool = false;

    if (toolCalls && toolCalls.length > 0) {
      for (const rawCall of toolCalls) {
        const call = getToolCall(rawCall);
        const blocked = shouldBlockReferenceTool(sessionId, call.toolName);
        logConversationEvent({
          sessionId,
          event: 'ai_tool_call',
          role: 'tool',
          metadata: {
            toolName: call.toolName,
            blocked,
            input: call.input,
          },
        });
        if (blocked) {
          blockedReferenceTool = true;
          continue;
        }

        if (call.toolName === 'update_profile_bucket') {
           const args = updateProfileBucketSchema.parse(call.input);
           const updatedBucket = applyProfileBucketUpdate(db, sessionId, args);
           advanceInterviewStatus(session, updatedBucket);
           const selfiePrompt = maybeRequestLifeStorySelfie(session, updatedBucket);
           const supportingReferenceRequest = maybeCreateSupportingReferenceUploadRequest(db, sessionId, args.entities);
           finalReply = selfiePrompt
             || supportingReferenceRequest?.prompt_text
             || await chooseDirectorReplyOrContinuation({
               sessionId,
               messages,
               streamedText: text,
               directorReply: args.directorReply,
               chatMessage: finalReply,
               activeReferenceRequest: getActiveReferenceRequest(db, sessionId) || null,
             });
        } else if (call.toolName === 'request_reference_upload') {
           const args = requestReferenceUploadSchema.parse(call.input);
           const request = createReferenceUploadRequest(db, sessionId, args);
           finalReply = request
             ? request.prompt_text
             : await chooseDirectorReplyOrContinuation({
               sessionId,
               messages,
               streamedText: text,
               activeReferenceRequest: getActiveReferenceRequest(db, sessionId) || null,
               retryReasons: ['The requested reference upload was already resolved; continue the interview without asking for another image.'],
             });
        } else if (call.toolName === 'add_reference_subject') {
           const args = addReferenceSubjectSchema.parse(call.input);
           const result = addReferenceSubject(db, sessionId, args);
           finalReply = await chooseDirectorReplyOrContinuation({
             sessionId,
             messages,
             streamedText: text,
             directorReply: args.directorReply || `I will remember ${args.displayName} as @${result.referenceAsset.stable_tag} for future scenes.`,
             activeReferenceRequest: getActiveReferenceRequest(db, sessionId) || null,
             retryReasons: ['A reference asset was labeled; resume the interview naturally without repeating raw @tag bookkeeping.'],
           });
        } else if (call.toolName === 'save_reference_description') {
           const args = saveReferenceDescriptionSchema.parse(call.input);
           saveReferenceDescription(db, sessionId, args);
           db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
             .run('INTERVIEW_DYNAMIC', sessionId);
           finalReply = await chooseDirectorReplyOrContinuation({
             sessionId,
             messages,
             streamedText: text,
             directorReply: args.directorReply,
             chatMessage: finalReply,
             activeReferenceRequest: getActiveReferenceRequest(db, sessionId) || null,
             retryReasons: ['A reference description was saved; resume the life interview from the latest story context.'],
           });
        } else if (call.toolName === 'generate_memory_sketch') {
           const args = memorySketchSchema.parse(call.input);
           if (args.protagonistVisible !== false && !hasProtagonistReferenceDecision(db, sessionId)) {
             createReferenceUploadRequest(db, sessionId, {
               targetType: 'protagonist',
               targetLabel: session.user_name || 'protagonist',
               promptText: protagonistReferencePrompt(session),
               reason: 'A protagonist reference can help keep the person on screen emotionally and visually consistent.',
               fallbackPrompt: 'No problem if you would rather not upload one. Could you describe how the protagonist should appear instead?',
             });
             finalReply = protagonistReferencePrompt(session);
             continue;
           }

           let imageUrl = ''; 
           let sketchError = '';
           recordMemorySketch(db, sessionId, {
             candidateId: args.candidateId,
             title: args.title,
             description: args.description,
             visualPrompt: args.visualPrompt,
           });
           
           // Immediately broadcast that we are generating an image to show loading skeleton
           broadcastSessionUpdate(sessionId, { 
             chat_history: [
                ...historyRows, 
                {
                   id: assistantMessageId,
                   session_id: sessionId,
                   role: 'assistant',
                   content: text ? text + '\n\ntrying to generate an image of your memory..' : 'trying to generate an image of your memory..',
                   options: null,
                   created_at: new Date().toISOString()
                }
             ]
           });

           try {
             const runwayClient = createRunwayClientForSession(db, session);
             const imageAsset = await generateImageAsset({
               promptText: args.visualPrompt,
               quality: SKETCH_IMAGE_QUALITY,
               ratio: imageRatio(session.aspect_ratio),
               sessionId,
               runwayClient,
             });
             imageUrl = imageAsset.localUrl;

             if (imageUrl) {
               recordMemorySketch(db, sessionId, {
                 candidateId: args.candidateId,
                 title: args.title,
                 description: args.description,
                 visualPrompt: args.visualPrompt,
                 sketchUrl: imageUrl,
               });
               createReferenceAsset(db, sessionId, {
                 localUrl: imageAsset.localUrl,
                 targetType: 'sketch',
                 targetLabel: args.title,
                 visionDescription: args.description,
                 usagePermissions: 'allowed',
                 source: 'generated',
               });
             }
           } catch (e) {
             console.error("RunwayML Sketch Error:", e);
             sketchError = isMissingUserCredentialError(e) ? MISSING_BYOK_MESSAGE : 'I could not generate that memory sketch yet.';
           }
           
           const sketchText = imageUrl ? `\n\n[Sketch: ${imageUrl}]` : '';
           const transitionText = "I made a first sketch of that memory. Does this feel emotionally close?";
           const failureText = sketchError ? `I could not generate that memory sketch yet: ${sketchError}` : transitionText;
           const visibleSketchMessage = sketchError ? failureText : (args.chatMessage || transitionText);
           
           if (text) {
              finalReply = text + "\n\n" + visibleSketchMessage + sketchText;
           } else {
              finalReply = visibleSketchMessage + sketchText;
           }
        } else if (call.toolName === 'save_sketch_feedback') {
           const args = saveSketchFeedbackSchema.parse(call.input);
           saveSketchFeedback(db, sessionId, args);
           finalReply = await chooseDirectorReplyOrContinuation({
             sessionId,
             messages,
             streamedText: text,
             directorReply: args.directorReply,
             chatMessage: finalReply,
             activeReferenceRequest: getActiveReferenceRequest(db, sessionId) || null,
           });
        } else if (call.toolName === 'propose_film_treatment') {
           const args = filmTreatmentSchema.parse(call.input);
           const treatment = proposeFilmTreatment(db, sessionId, args);
           logConversationEvent({
             sessionId,
             event: 'film_treatment_persisted',
             metadata: {
               treatmentId: treatment.id,
               title: treatment.title,
               status: treatment.status,
             },
           });
           finalReply = filmTreatmentReviewHandoff();
        } else if (call.toolName === 'propose_scene_outline') {
           const parsedOutline = parseProposeSceneOutlineToolInput(call.input);
           logConversationEvent({
             sessionId,
             event: 'scene_outline_tool_received',
             role: 'tool',
             metadata: {
               ...sceneOutlineToolInputSummary(call.input),
               parseSuccess: parsedOutline.success,
               normalized: parsedOutline.normalized,
               issues: parsedOutline.issues,
             },
           });

           if (!parsedOutline.success) {
             logConversationEvent({
               sessionId,
               event: 'scene_outline_tool_invalid',
               role: 'tool',
               metadata: {
                 ...sceneOutlineToolInputSummary(call.input),
                 issues: parsedOutline.issues,
               },
             });

             const bucketBeforeFallback = loadStoryBucket(db, sessionId);
             if (bucketBeforeFallback.treatment) {
               const outline = await draftSceneOutlineAfterTreatmentApproval(sessionId);
               finalReply = outline.directorReply
                 || 'I drafted the scene outline below. Review the scenes and approve them when they feel right, or leave notes for changes.';
             } else {
               finalReply = await generateDirectorContinuation(sessionId, messages, {
                 activeReferenceRequest: getActiveReferenceRequest(db, sessionId) || null,
                 retryReasons: ['The model attempted to draft scenes before a valid film treatment existed; continue the interview or treatment step naturally.'],
               });
             }
             continue;
           }

           if (parsedOutline.normalized) {
             logConversationEvent({
               sessionId,
               event: 'scene_outline_tool_normalized',
               role: 'tool',
               metadata: {
                 issues: parsedOutline.issues,
                 sceneCount: parsedOutline.data.scenes.length,
                 titles: sceneOutlineTitles(parsedOutline.data.scenes),
               },
             });
           }

           const args = parsedOutline.data;
           const bucketBeforeOutline = loadStoryBucket(db, sessionId);
           if (!bucketBeforeOutline.treatment) {
             finalReply = text || 'Before I turn this into scenes, I want to shape the film treatment first: the title, emotional thesis, arc, visual motif, narrator style, ending feeling, and what to avoid. What should this short film feel like at the end?';
             continue;
           }
           const readiness = evaluateLifeStoryOutlineReadiness(bucketBeforeOutline);
           if (!readiness.ready && !treatmentApprovalRequested) {
             finalReply = text || readiness.nextQuestion;
             continue;
           }

           const needsProtagonistReference = args.scenes.some((scene) => scene.protagonistVisible !== false);
           if (needsProtagonistReference && !hasProtagonistReferenceDecision(db, sessionId)) {
             createReferenceUploadRequest(db, sessionId, {
               targetType: 'protagonist',
               targetLabel: session.user_name || 'protagonist',
               promptText: protagonistReferencePrompt(session),
               reason: 'The outline includes scenes where the protagonist appears.',
               fallbackPrompt: 'No problem if you would rather not upload one. Could you describe how the protagonist should appear instead?',
             });
             finalReply = protagonistReferencePrompt(session);
             continue;
           }

           proposeSceneOutline(db, sessionId, args);
           if (treatmentApprovalRequested) approveFilmTreatment(db, sessionId);
           logConversationEvent({
             sessionId,
             event: 'scene_outline_persisted',
             metadata: {
               source: 'tool_call',
               sceneCount: args.scenes.length,
               titles: sceneOutlineTitles(args.scenes),
               scenes: sceneOutlineLogScenes(args.scenes),
             },
           });
           finalReply = text
             || args.directorReply
             || args.chatMessage
             || 'I drafted the scene outline below. Review the scenes and approve them when they feel right, or leave notes for changes.';
        } else if (call.toolName === 'revise_scene_outline') {
           const args = reviseSceneOutlineSchema.parse(call.input);
           reviseSceneOutline(db, sessionId, args);
           finalReply = text
             || args.directorReply
             || finalReply
             || 'I revised the scene outline. Take a look and tell me whether it now feels right.';
        } else if (call.toolName === 'lock_scene_outline') {
           lockSceneOutlineSchema.parse(call.input);
           lockSceneOutlineForProduction(db, sessionId);

            runAutomaticProductionPipeline(sessionId).catch(console.error);

            const productionMessage = "Perfect. I am moving from outline into production now. You will see each scene come to life as the cut takes shape, and the final render will start automatically.";
            finalReply = text ? `${text}\n\n${productionMessage}` : productionMessage;
        }
      }
    }

    const bucketAfterTools = loadStoryBucket(db, sessionId);
    const shouldDraftOutlineAfterTurn = (
      (treatmentApprovalRequested || movieCreationRequested)
      && (
        isTreatmentApprovalForOutline(latestUserMessage, bucketAfterTools)
        || Boolean(movieCreationRequested && bucketAfterTools.treatment && bucketAfterTools.sceneOutline.length === 0)
      )
      && !getActiveReferenceRequest(db, sessionId)
    );

    if (blockedReferenceTool && shouldDraftOutlineAfterTurn) {
      finalReply = '';
    } else if (blockedReferenceTool && (!finalReply?.trim() || /I will remember[\s\S]*@[a-z0-9_]+/i.test(finalReply))) {
      finalReply = await generateDirectorContinuation(sessionId, messages, {
        activeReferenceRequest: getActiveReferenceRequest(db, sessionId) || null,
        retryReasons: ['A blocked reference tool call was discarded; continue the interview naturally without mentioning tools or references.'],
      });
    }

    if (shouldDraftOutlineAfterTurn) {
      const outline = await draftSceneOutlineAfterTreatmentApproval(sessionId);
      const outlineReply = outline.directorReply || 'I drafted the scene outline below. Review the scenes and approve them when they feel right, or leave notes for changes.';
      finalReply = outlineReply;
    }

    if (!finalReply?.trim()) {
      finalReply = await generateDirectorContinuation(sessionId, messages, {
        activeReferenceRequest: getActiveReferenceRequest(db, sessionId) || null,
      });
    }

    if (finalReply && !finalReply.includes('trying to generate an image of your memory..')) {
      let optionsStr = null;
      const optionsMatch = finalReply.match(/\[OPTIONS\]([\s\S]*)/i);
      if (optionsMatch) {
        const optionsList = optionsMatch[1].split('|').map(o => o.trim()).filter(Boolean);
        optionsStr = JSON.stringify(optionsList);
        finalReply = finalReply.replace(/\[OPTIONS\]([\s\S]*)/i, '').trim();
      }

      // Save assistant message using the same assistantMessageId we streamed with
      db.prepare('INSERT INTO chat_history (id, session_id, role, content, options) VALUES (?, ?, ?, ?, ?)')
        .run(assistantMessageId, sessionId, 'assistant', finalReply, optionsStr);
      logConversationEvent({
        sessionId,
        event: 'assistant_message',
        role: 'assistant',
        content: finalReply,
        metadata: {
          options: optionsStr ? JSON.parse(optionsStr) : null,
        },
      });

      broadcastSessionUpdate(sessionId, getFullSessionUpdate(sessionId));
    }

    return { processed: true, busy: false };
  } catch (error) {
    console.error('Interview turn failed:', error);
    const assistantMessageId = uuidv4();
    const finalReply = isMissingUserCredentialError(error)
      ? MISSING_BYOK_MESSAGE
      : 'I lost the thread for a moment. Please send that last answer again, and I will pick it up carefully.';

    try {
      db.prepare('INSERT INTO chat_history (id, session_id, role, content, options) VALUES (?, ?, ?, ?, ?)')
        .run(assistantMessageId, sessionId, 'assistant', finalReply, null);
      logConversationEvent({
        sessionId,
        event: 'interview_turn_error',
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      logConversationEvent({
        sessionId,
        event: 'assistant_message',
        role: 'assistant',
        content: finalReply,
      });

      broadcastSessionUpdate(sessionId, {
        ...getFullSessionUpdate(sessionId),
        error: safeInterviewErrorMessage(error),
      });
    } catch (broadcastError) {
      console.error('Failed to persist interview failure message:', broadcastError);
    }
    return { processed: false, busy: false, error };
  } finally {
    releaseInterviewTurn(db, sessionId, turnToken);
  }
}
