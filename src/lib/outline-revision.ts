import type Database from 'better-sqlite3';
import { generateText } from 'ai';
import { z } from 'zod';
import { proposeSceneOutlineSchema } from './ai/tools';
import { sceneOutlineFieldContract, storySceneDiversityPrompt } from './ai/prompts/scene-outline';
import { logConversationEvent } from './conversation-logs';
import { openRouterModelForSession } from './providers/user-credentials';
import { parseProposeSceneOutlineToolInput } from './scene-outline-tool-input';
import { loadStoryBucket, proposeSceneOutline, reviseSceneOutline } from './story-bucket';
import type { SceneOutlineRow, StoryBucket } from './types';

type SqliteDatabase = Database.Database;

const MAX_OUTLINE_REVISION_OUTPUT_TOKENS = 8192;

const clarificationSchema = z.object({
  revisionStatus: z.literal('needs_clarification'),
  question: z.string().min(1),
  revisionMessage: z.string().min(1).optional(),
});

const updatedRevisionSchema = proposeSceneOutlineSchema.extend({
  revisionStatus: z.literal('updated').optional(),
  revisionMessage: z.string().min(1).optional(),
});

type UpdatedRevisionPayload = z.infer<typeof updatedRevisionSchema>;

export type OutlineRevisionGenerateInput = {
  system: string;
  prompt: string;
  maxOutputTokens: number;
};

export type OutlineRevisionDeps = {
  generateRevisionText?: (input: OutlineRevisionGenerateInput) => Promise<string>;
};

export type OutlineRevisionInput = {
  sceneOutlineId: string;
  comment: string;
};

export type OutlineRevisionResult =
  | {
    revisionStatus: 'updated';
    revisionMessage?: string;
    sceneOutline: SceneOutlineRow[];
  }
  | {
    revisionStatus: 'needs_clarification';
    revisionMessage?: string;
    question: string;
    sceneOutline: SceneOutlineRow[];
  };

function zodIssuePath(issue: z.core.$ZodIssue) {
  return issue.path.length ? issue.path.join('.') : '(root)';
}

function zodIssueStrings(error: z.ZodError) {
  return error.issues.map((issue) => `${zodIssuePath(issue)}: ${issue.message}`);
}

function findBalancedJsonObject(text: string) {
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return '';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) return text.slice(firstBrace, index + 1);
  }

  return '';
}

function extractJsonObjectText(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return findBalancedJsonObject(trimmed) || trimmed;
}

function parseOutlineRevisionText(text: string) {
  try {
    const raw = JSON.parse(extractJsonObjectText(text));
    const clarification = clarificationSchema.safeParse(raw);
    if (clarification.success) {
      return {
        success: true as const,
        data: clarification.data,
        normalized: false,
        issues: [] as string[],
      };
    }

    const outline = parseProposeSceneOutlineToolInput(raw);
    if (outline.success) {
      const status = typeof raw?.revisionStatus === 'string' ? raw.revisionStatus : 'updated';
      if (status !== 'updated') {
        return {
          success: false as const,
          normalized: false,
          issues: [`revisionStatus: expected "updated" or "needs_clarification", received "${status}"`],
        };
      }

      const updated = updatedRevisionSchema.safeParse({
        ...outline.data,
        revisionStatus: 'updated',
        revisionMessage: typeof raw?.revisionMessage === 'string' ? raw.revisionMessage : undefined,
      });
      if (!updated.success) {
        return {
          success: false as const,
          normalized: false,
          issues: zodIssueStrings(updated.error),
        };
      }

      return {
        success: true as const,
        data: updated.data,
        normalized: outline.normalized,
        issues: outline.issues,
      };
    }

    return outline;
  } catch (error) {
    return {
      success: false as const,
      normalized: false,
      issues: [`json: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function parseArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function compact(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() || '';
}

function formatCurrentOutline(rows: SceneOutlineRow[]) {
  return rows.map((scene) => ({
    id: scene.id,
    sceneIndex: scene.scene_index,
    title: scene.title,
    summary: scene.summary,
    narratorText: scene.narrator_text,
    imagePrompt: scene.image_prompt,
    videoPrompt: scene.video_prompt,
    duration: scene.duration,
    emotionalPurpose: scene.emotional_purpose,
    referenceNeeds: parseArray(scene.reference_needs_json),
    referenceAssetIds: parseArray(scene.reference_asset_ids_json),
    protagonistVisible: Boolean(scene.protagonist_visible),
  }));
}

function formatStoryContext(bucket: StoryBucket) {
  const profile = bucket.profile;
  const treatment = bucket.treatment;
  return {
    profile: profile ? {
      protagonistName: profile.protagonist_name,
      age: profile.age,
      profession: profile.profession,
      currentLocation: profile.current_location,
      lifePhase: profile.life_phase,
      summary: profile.summary,
      themes: parseArray(profile.themes_json),
    } : null,
    treatment: treatment ? {
      title: treatment.title,
      emotionalThesis: treatment.emotional_thesis,
      narrativeArc: treatment.narrative_arc,
      visualMotif: treatment.visual_motif,
      narratorStyle: treatment.narrator_style,
      endingFeeling: treatment.ending_feeling,
      avoid: parseArray(treatment.avoid_json),
    } : null,
    memoryCandidates: bucket.memoryCandidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      description: candidate.description,
      emotionalPurpose: candidate.emotional_purpose,
      visualSummary: candidate.visual_summary,
      people: parseArray(candidate.people_json),
      places: parseArray(candidate.places_json),
    })),
    entities: bucket.entities.map((entity) => ({
      id: entity.id,
      type: entity.type,
      displayName: entity.display_name,
      relationship: entity.relationship,
      description: entity.description,
    })),
    references: bucket.referenceAssets.map((asset) => {
      const owner = bucket.entities.find((entity) => entity.id === asset.owner_entity_id);
      return {
        id: asset.id,
        tag: asset.stable_tag,
        targetType: asset.target_type,
        targetLabel: owner?.display_name || asset.target_type,
        usable: asset.usage_permissions === 'allowed' && asset.source !== 'description',
        description: asset.vision_description,
      };
    }),
  };
}

function outlineLogScenes(rows: SceneOutlineRow[]) {
  return rows.map((scene) => ({
    id: scene.id,
    index: scene.scene_index,
    title: scene.title,
    summary: scene.summary,
    narratorText: scene.narrator_text,
    duration: scene.duration,
    emotionalPurpose: scene.emotional_purpose,
  }));
}

function buildOutlineRevisionPrompt(bucket: StoryBucket, targetScene: SceneOutlineRow, comment: string) {
  const context = formatStoryContext(bucket);
  const currentOutline = formatCurrentOutline(bucket.sceneOutline);

  return `The user is reviewing a LifeStory film outline. Apply their note to the review card, not to the interview chat.

Target scene:
${JSON.stringify(formatCurrentOutline([targetScene])[0], null, 2)}

User note:
${comment.trim()}

Story context:
${JSON.stringify(context, null, 2)}

Current unlocked outline:
${JSON.stringify(currentOutline, null, 2)}

Scene diversity guidance:
${storySceneDiversityPrompt}

Field contract:
${sceneOutlineFieldContract}

Return only one JSON object.

If the note can be applied, return:
{
  "revisionStatus": "updated",
  "revisionMessage": "One short sentence for an inline panel status.",
  "scenes": [
    {
      "title": "2-6 word card label",
      "summary": "12-25 word sentence explaining what happens and why it matters emotionally.",
      "narratorText": "Actual spoken narration within floor(duration * 2.8) words.",
      "imagePrompt": "Production-ready still prompt.",
      "videoPrompt": "Production-ready camera/action prompt.",
      "duration": 2,
      "emotionalPurpose": "Private emotional job.",
      "referenceNeeds": [],
      "referenceAssetIds": [],
      "protagonistVisible": true
    }
  ]
}

If the note is impossible to apply without one specific fact, return:
{
  "revisionStatus": "needs_clarification",
  "question": "One concise question to show inline under the scene."
}

Rules:
- Return the complete revised outline, not only the changed scene.
- You may split, insert, delete, or reorder unlocked scenes when the user asks for structural changes.
- Preserve existing strong scenes unless the note requires changing them.
- Do not ask broad interview questions or readiness questions.
- Do not include standard protagonist intro/outro bookends unless they are already in the current outline and still useful; the server can maintain bookends.
- Keep title and summary distinct.
- Keep narratorText as spoken movie narration, not a production note or emotional-purpose label.
- Do not include description-only references in referenceAssetIds.`;
}

async function generateRevisionText(database: SqliteDatabase, sessionId: string, prompt: string, deps: OutlineRevisionDeps = {}) {
  const system = 'You are a film outline revision drafter. Return only strict JSON. Do not continue the interview chat.';
  if (deps.generateRevisionText) {
    return deps.generateRevisionText({
      system,
      prompt,
      maxOutputTokens: MAX_OUTLINE_REVISION_OUTPUT_TOKENS,
    });
  }

  const { text } = await generateText({
    model: openRouterModelForSession(database, sessionId, 'google/gemini-3.1-flash-lite'),
    maxOutputTokens: MAX_OUTLINE_REVISION_OUTPUT_TOKENS,
    system,
    prompt,
  });
  return text;
}

export async function reviseOutlineWithAi(
  database: SqliteDatabase,
  sessionId: string,
  input: OutlineRevisionInput,
  deps: OutlineRevisionDeps = {},
): Promise<OutlineRevisionResult> {
  const comment = input.comment.trim();
  if (!comment) throw new Error('Outline revision comment is required.');

  const bucket = loadStoryBucket(database, sessionId);
  const targetScene = bucket.sceneOutline.find((scene) => scene.id === input.sceneOutlineId);
  if (!targetScene) throw new Error('Scene outline item not found for this session.');

  logConversationEvent({
    sessionId,
    event: 'outline_revision_requested',
    role: 'user',
    content: comment,
    metadata: {
      sceneOutlineId: targetScene.id,
      sceneIndex: targetScene.scene_index,
      sceneTitle: targetScene.title,
    },
  });

  reviseSceneOutline(database, sessionId, {
    sceneOutlineId: targetScene.id,
    comment,
  });

  const prompt = buildOutlineRevisionPrompt(bucket, targetScene, comment);

  try {
    const text = await generateRevisionText(database, sessionId, prompt, deps);
    const parsed = parseOutlineRevisionText(text);

    logConversationEvent({
      sessionId,
      event: 'outline_revision_generated',
      role: 'assistant',
      content: text,
      metadata: {
        parseSuccess: parsed.success,
        normalized: parsed.normalized,
        issues: parsed.issues,
      },
    });

    if (!parsed.success) {
      throw new Error(`AI outline revision could not be parsed: ${parsed.issues.join('; ')}`);
    }

    if (parsed.data.revisionStatus === 'needs_clarification') {
      const current = loadStoryBucket(database, sessionId).sceneOutline;
      logConversationEvent({
        sessionId,
        event: 'outline_revision_clarification',
        role: 'assistant',
        content: parsed.data.question,
        metadata: {
          sceneOutlineId: targetScene.id,
          sceneIndex: targetScene.scene_index,
          sceneTitle: targetScene.title,
        },
      });
      return {
        revisionStatus: 'needs_clarification',
        revisionMessage: parsed.data.revisionMessage,
        question: parsed.data.question,
        sceneOutline: current,
      };
    }

    const outlinePayload = parsed.data as UpdatedRevisionPayload;
    const persisted = proposeSceneOutline(database, sessionId, outlinePayload);
    logConversationEvent({
      sessionId,
      event: 'outline_revision_persisted',
      metadata: {
        sceneOutlineId: targetScene.id,
        source: 'ai_revise',
        sceneCount: persisted.length,
        titles: persisted.map((scene) => scene.title),
        scenes: outlineLogScenes(persisted),
      },
    });

    return {
      revisionStatus: 'updated',
      revisionMessage: compact(outlinePayload.revisionMessage)
        || compact(outlinePayload.directorReply)
        || compact(outlinePayload.chatMessage)
        || 'I updated the outline.',
      sceneOutline: persisted,
    };
  } catch (error) {
    logConversationEvent({
      sessionId,
      event: 'outline_revision_error',
      metadata: {
        sceneOutlineId: targetScene.id,
        sceneIndex: targetScene.scene_index,
        sceneTitle: targetScene.title,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
