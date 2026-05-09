import { tool } from 'ai';
import { z } from 'zod';

const optionalStringArray = z.array(z.string().min(1)).optional();

export const updateProfileBucketSchema = z.object({
  directorReply: z.string().min(1).optional(),
  profile: z.object({
    protagonistName: z.string().optional(),
    age: z.string().optional(),
    pronouns: z.string().optional(),
    lifePhase: z.string().optional(),
    emotionalTone: z.string().optional(),
    visualDescription: z.string().optional(),
    protagonistReferenceAssetId: z.string().optional(),
    summary: z.string().optional(),
    themes: optionalStringArray,
  }).optional(),
  entities: z.array(z.object({
    id: z.string().optional(),
    type: z.enum(['protagonist', 'person', 'family', 'friend', 'place', 'object', 'pet', 'school', 'workplace', 'keepsake']).or(z.string().min(1)),
    displayName: z.string().min(1),
    description: z.string().optional(),
    relationship: z.string().optional(),
    consentState: z.enum(['unknown', 'allowed', 'restricted', 'denied']).optional(),
    referenceAssetId: z.string().optional(),
  })).optional(),
  timelineEvents: z.array(z.object({
    label: z.string().min(1),
    description: z.string().min(1),
    era: z.string().optional(),
    emotion: z.string().optional(),
  })).optional(),
  themes: optionalStringArray,
  memoryCandidates: z.array(z.object({
    id: z.string().optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    emotionalPurpose: z.string().optional(),
    visualSummary: z.string().optional(),
    people: optionalStringArray,
    places: optionalStringArray,
    referencesNeeded: optionalStringArray,
    status: z.enum(['candidate', 'sketched', 'accepted', 'rejected', 'revised']).optional(),
  })).optional(),
});

export const requestReferenceUploadSchema = z.object({
  targetType: z.enum(['protagonist', 'person', 'family', 'friend', 'place', 'object', 'keepsake']).or(z.string().min(1)),
  targetLabel: z.string().min(1),
  promptText: z.string().min(1),
  reason: z.string().optional(),
  fallbackPrompt: z.string().optional(),
  entityId: z.string().optional(),
});

export const saveReferenceDescriptionSchema = z.object({
  directorReply: z.string().min(1).optional(),
  targetType: z.string().min(1),
  targetLabel: z.string().min(1),
  description: z.string().min(1),
  usagePermissions: z.enum(['allowed', 'restricted', 'description_only']).optional(),
});

export const memorySketchSchema = z.object({
  candidateId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  visualPrompt: z.string().min(1),
  protagonistVisible: z.boolean().optional(),
  chatMessage: z.string().optional(),
});

export const saveSketchFeedbackSchema = z.object({
  directorReply: z.string().min(1).optional(),
  candidateId: z.string().min(1),
  feedback: z.enum(['accepted', 'rejected', 'revised']),
  note: z.string().optional(),
});

const outlineSceneSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  narratorText: z.string().min(1),
  imagePrompt: z.string().min(1),
  videoPrompt: z.string().min(1),
  duration: z.number().min(2).max(10),
  emotionalPurpose: z.string().optional(),
  referenceNeeds: optionalStringArray,
  referenceAssetIds: optionalStringArray,
  protagonistVisible: z.boolean().optional(),
});

export const proposeSceneOutlineSchema = z.object({
  scenes: z.array(outlineSceneSchema).min(1).max(30),
  chatMessage: z.string().optional(),
  directorReply: z.string().min(1).optional(),
});

export const reviseSceneOutlineSchema = z.object({
  directorReply: z.string().min(1).optional(),
  comment: z.string().optional(),
  sceneOutlineId: z.string().optional(),
  sceneIndex: z.number().int().nonnegative().optional(),
  updates: z.object({
    title: z.string().optional(),
    summary: z.string().optional(),
    narratorText: z.string().optional(),
    imagePrompt: z.string().optional(),
    videoPrompt: z.string().optional(),
    duration: z.number().min(2).max(10).optional(),
    emotionalPurpose: z.string().optional(),
    referenceNeeds: optionalStringArray,
    referenceAssetIds: optionalStringArray,
    protagonistVisible: z.boolean().optional(),
  }).optional(),
});

export const lockSceneOutlineSchema = z.object({
  confirmation: z.string().optional(),
});

export const aiTools = {
  update_profile_bucket: tool({
    description: 'Preserve profile facts, timeline events, people, places, themes, and candidate scenes after an interview turn. Include directorReply with the exact warm user-facing response and next question.',
    inputSchema: updateProfileBucketSchema,
  }),
  request_reference_upload: tool({
    description: 'Ask for an optional reference image for a concrete protagonist, person, place, or object and include a graceful skip path.',
    inputSchema: requestReferenceUploadSchema,
  }),
  save_reference_description: tool({
    description: 'Save visual details when the user skips or describes a reference instead of uploading an image. Include directorReply with the next natural question.',
    inputSchema: saveReferenceDescriptionSchema,
  }),
  generate_memory_sketch: tool({
    description: 'Create a user-facing preview sketch for one candidate scene so the user can react in chat before outline approval. Set protagonistVisible false only when the protagonist is not shown.',
    inputSchema: memorySketchSchema,
  }),
  save_sketch_feedback: tool({
    description: 'Record whether the user accepted, rejected, or revised a generated memory sketch. Include directorReply with the next natural response.',
    inputSchema: saveSketchFeedbackSchema,
  }),
  propose_scene_outline: tool({
    description: 'Create a reviewable scene outline with durations, emotional purpose, narration, prompts, and reference needs. Include directorReply or chatMessage for the user-facing introduction.',
    inputSchema: proposeSceneOutlineSchema,
  }),
  revise_scene_outline: tool({
    description: 'Apply a user comment or requested change to the reviewable scene outline without starting production. Include directorReply with the next natural response.',
    inputSchema: reviseSceneOutlineSchema,
  }),
  lock_scene_outline: tool({
    description: 'Freeze the approved outline and hand it to production only after the user clearly approves it.',
    inputSchema: lockSceneOutlineSchema,
  }),
};

export function getToolCall(call: unknown) {
  if (typeof call !== 'object' || call === null) {
    return { toolName: '', input: {} };
  }
  const record = call as Record<string, unknown>;
  const toolName = typeof record.toolName === 'string' ? record.toolName : '';
  const input = record.args ?? record.input ?? record.parameters ?? {};
  return { toolName, input };
}
