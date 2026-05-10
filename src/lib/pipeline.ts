import db from './db';
import { broadcastSessionUpdate } from './sse';
import { generateText, streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { v4 as uuidv4 } from 'uuid';
import { runFrameGenerationPhase, runMediaGenerationPhase } from './pipeline_media';
import type { ChatHistoryRow, InterviewMessage, SceneRow, SessionRow, StoryBucket, UserUploadRow } from './types';
import { buildDirectorContinuationPrompt } from './director-continuation';
import {
  aiTools,
  filmTreatmentSchema,
  getToolCall,
  lockSceneOutlineSchema,
  memorySketchSchema,
  proposeSceneOutlineSchema,
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
import {
  applyProfileBucketUpdate,
  createReferenceAsset,
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
} from './story-bucket';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
    parts.push(`Candidate scenes: ${bucket.memoryCandidates.map((candidate) => `${candidate.title}: ${candidate.description}`).join('; ')}`);
  }

  if (bucket.referenceAssets.length) {
    parts.push(`References: ${bucket.referenceAssets.map((asset) => `@${asset.stable_tag}${asset.vision_description ? ` (${asset.vision_description})` : ''}`).join('; ')}`);
  }

  if (bucket.sceneOutline.length) {
    parts.push(`Current outline: ${bucket.sceneOutline.map((scene) => `${scene.scene_index + 1}. ${scene.title}: ${scene.summary}`).join('; ')}`);
  }

  return parts.join('\n');
}

function advanceInterviewStatus(session: SessionRow, bucket: StoryBucket) {
  if (session.status === 'INTERVIEW_ONBOARDING') {
    if (session.mode === 'single_memory' && bucket.memoryCandidates.length > 0) {
      db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('INTERVIEW_DYNAMIC', session.id);
      return;
    }

    if (
      session.mode === 'life_story'
      && bucket.profile?.protagonist_name
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

function maybeRequestLifeStorySelfie(session: SessionRow, bucket: StoryBucket) {
  if (session.mode !== 'life_story') return null;
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

async function generateDirectorContinuation(sessionId: string, messages: InterviewMessage[]) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow;
  const bucket = loadStoryBucket(db, sessionId);
  const prompt = buildDirectorContinuationPrompt({
    status: session.status,
    storyContext: formatStoryBucketForPrompt(bucket),
  });

  const { text } = await generateText({
    model: openrouter('google/gemini-3.1-flash-lite'),
    system: prompt,
    messages,
    toolChoice: 'none',
  });

  return text.trim();
}

export async function processInterviewTurn(sessionId: string) {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

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
    const systemPrompt = buildInterviewSystemPrompt({
      mode: session.mode,
      status: session.status,
      storyContext: formatStoryBucketForPrompt(storyBucket),
      uploadContext,
      activeReferenceRequest: getActiveReferenceRequest(db, sessionId) || null,
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
      model: openrouter('google/gemini-3.1-flash-lite'),
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

    if (toolCalls && toolCalls.length > 0) {
      for (const rawCall of toolCalls) {
        const call = getToolCall(rawCall);

        if (call.toolName === 'update_profile_bucket') {
           const args = updateProfileBucketSchema.parse(call.input);
           const updatedBucket = applyProfileBucketUpdate(db, sessionId, args);
           advanceInterviewStatus(session, updatedBucket);
           const selfiePrompt = maybeRequestLifeStorySelfie(session, updatedBucket);
           finalReply = selfiePrompt || text || args.directorReply || finalReply;
        } else if (call.toolName === 'request_reference_upload') {
           const args = requestReferenceUploadSchema.parse(call.input);
           const request = createReferenceUploadRequest(db, sessionId, args);
           finalReply = request
             ? (text || args.promptText)
             : (text || 'I already have the protagonist reference, so I will keep using that unless we need a specific scene-era image later. What should we explore next?');
        } else if (call.toolName === 'save_reference_description') {
           const args = saveReferenceDescriptionSchema.parse(call.input);
           saveReferenceDescription(db, sessionId, args);
           db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
             .run('INTERVIEW_DYNAMIC', sessionId);
           finalReply = text || args.directorReply || finalReply;
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
             const imageAsset = await generateImageAsset({
               promptText: args.visualPrompt,
               quality: SKETCH_IMAGE_QUALITY,
               ratio: imageRatio(session.aspect_ratio),
               sessionId,
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
             sketchError = formatError(e);
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
           finalReply = text || args.directorReply || finalReply;
        } else if (call.toolName === 'propose_film_treatment') {
           const args = filmTreatmentSchema.parse(call.input);
           proposeFilmTreatment(db, sessionId, args);
           finalReply = text || args.directorReply || finalReply;
        } else if (call.toolName === 'propose_scene_outline') {
           const args = proposeSceneOutlineSchema.parse(call.input);
           const bucketBeforeOutline = loadStoryBucket(db, sessionId);
           if (!bucketBeforeOutline.treatment) {
             finalReply = text || 'Before I turn this into scenes, I want to shape the film treatment first: the title, emotional thesis, arc, visual motif, narrator style, ending feeling, and what to avoid. What should this short film feel like at the end?';
             continue;
           }
           if (session.mode === 'life_story') {
             const readiness = evaluateLifeStoryOutlineReadiness(bucketBeforeOutline);
             if (!readiness.ready) {
               finalReply = text || readiness.nextQuestion;
               continue;
             }
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
           finalReply = text || args.directorReply || args.chatMessage || finalReply;
        } else if (call.toolName === 'revise_scene_outline') {
           const args = reviseSceneOutlineSchema.parse(call.input);
           reviseSceneOutline(db, sessionId, args);
           finalReply = text || args.directorReply || finalReply;
        } else if (call.toolName === 'lock_scene_outline') {
           lockSceneOutlineSchema.parse(call.input);
           lockSceneOutlineForProduction(db, sessionId);

            // Fire off phase 1 of generation (Images only)
            const runner = session.mode === 'life_story' ? runFrameGenerationPhase : runMediaGenerationPhase;
            runner(sessionId).catch(console.error);

            const productionMessage = "Perfect. I am moving from outline into production now. You will see each scene come to life as the cut takes shape.";
            finalReply = text ? `${text}\n\n${productionMessage}` : productionMessage;
        }
      }
    }

    if (!finalReply?.trim()) {
      finalReply = await generateDirectorContinuation(sessionId, messages);
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

      broadcastSessionUpdate(sessionId, getFullSessionUpdate(sessionId));
    }

  } catch (error) {
    console.error('Interview turn failed:', error);
    const assistantMessageId = uuidv4();
    const finalReply = 'I lost the thread for a moment. Please send that last answer again, and I will pick it up carefully.';

    try {
      db.prepare('INSERT INTO chat_history (id, session_id, role, content, options) VALUES (?, ?, ?, ?, ?)')
        .run(assistantMessageId, sessionId, 'assistant', finalReply, null);

      broadcastSessionUpdate(sessionId, {
        ...getFullSessionUpdate(sessionId),
        error: formatError(error),
      });
    } catch (broadcastError) {
      console.error('Failed to persist interview failure message:', broadcastError);
    }
  }
}
