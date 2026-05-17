import { generateObject } from 'ai';
import { z } from 'zod';
import { createOpenRouterModel } from './ai';
import { narrationWordBudgetForDuration } from './narration-budget';

export const MAX_WHOLE_FILM_NARRATION_OUTPUT_TOKENS = 4096;
const DEFAULT_WHOLE_FILM_NARRATION_MODEL = process.env.LIFESTORY_NARRATION_MODEL || 'anthropic/claude-sonnet-4.5';

const wholeFilmNarrationSchema = z.object({
  voiceNotes: z.string().optional(),
  scenes: z.array(z.object({
    sceneIndex: z.number(),
    narrationText: z.string().min(1),
  })),
});

export type WholeFilmNarrationSceneInput = {
  id?: string;
  sceneIndex?: number;
  scene_index?: number;
  title: string;
  summary?: string | null;
  emotionalPurpose?: string | null;
  emotional_purpose?: string | null;
  imagePrompt?: string | null;
  image_prompt?: string | null;
  videoPrompt?: string | null;
  video_prompt?: string | null;
  duration: number | null;
};

export type WholeFilmNarrationInput = {
  treatment?: unknown;
  storyContext: string;
  scenes: WholeFilmNarrationSceneInput[];
  diagnostics?: string[];
};

export type WholeFilmNarrationResult = z.infer<typeof wholeFilmNarrationSchema>;

type GenerateNarrationObjectInput = {
  prompt: string;
  diagnostics: string[];
  attempt: number;
};

type WholeFilmNarrationPlannerInput = WholeFilmNarrationInput & {
  openrouterApiKey?: string;
  modelId?: string;
  maxAttempts?: number;
  generateNarrationObject?: (input: GenerateNarrationObjectInput) => Promise<unknown>;
};

export function wholeFilmNarrationSchemaIsAnthropicCompatible() {
  const jsonSchema = z.toJSONSchema(wholeFilmNarrationSchema);
  const serialized = JSON.stringify(jsonSchema);
  return !/"type":"integer"/.test(serialized)
    && !/"minimum":/.test(serialized)
    && !/"maximum":/.test(serialized);
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function wordCount(value: string) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  return words.length;
}

function sceneIndex(scene: WholeFilmNarrationSceneInput) {
  const index = typeof scene.sceneIndex === 'number' ? scene.sceneIndex : scene.scene_index;
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : 0;
}

function treatmentLine(treatment: unknown) {
  if (!treatment || typeof treatment !== 'object') return 'No approved treatment was supplied.';
  const record = treatment as Record<string, unknown>;
  const avoid = cleanText(record.avoid_json);
  return [
    `Title: ${cleanText(record.title) || 'Untitled film'}`,
    `Emotional thesis: ${cleanText(record.emotionalThesis) || cleanText(record.emotional_thesis) || 'not specified'}`,
    `Narrative arc: ${cleanText(record.narrativeArc) || cleanText(record.narrative_arc) || 'not specified'}`,
    `Visual motif: ${cleanText(record.visualMotif) || cleanText(record.visual_motif) || 'not specified'}`,
    `Narrator style: ${cleanText(record.narratorStyle) || cleanText(record.narrator_style) || 'not specified'}`,
    `Ending feeling: ${cleanText(record.endingFeeling) || cleanText(record.ending_feeling) || 'not specified'}`,
    avoid ? `Avoid: ${avoid}` : '',
  ].filter(Boolean).join('\n');
}

function scenePromptBlock(scene: WholeFilmNarrationSceneInput) {
  const index = sceneIndex(scene);
  const title = cleanText(scene.title) || `Scene ${index + 1}`;
  const summary = cleanText(scene.summary);
  const emotionalPurpose = cleanText(scene.emotionalPurpose) || cleanText(scene.emotional_purpose);
  const imagePrompt = cleanText(scene.imagePrompt) || cleanText(scene.image_prompt);
  const videoPrompt = cleanText(scene.videoPrompt) || cleanText(scene.video_prompt);
  const duration = Number(scene.duration) > 0 ? Number(scene.duration) : 5;
  const budget = narrationWordBudgetForDuration(duration);

  return [
    `Scene index: ${index}`,
    `Scene title: ${title}`,
    `Duration: ${duration} seconds`,
    `Narration word budget: ${budget} words maximum`,
    `What this scene must cover: ${summary || title}${emotionalPurpose ? ` Emotional purpose: ${emotionalPurpose}` : ''}`,
    imagePrompt ? `Image direction: ${imagePrompt}` : '',
    videoPrompt ? `Motion direction: ${videoPrompt}` : '',
  ].filter(Boolean).join('\n');
}

export function buildWholeFilmNarrationPrompt(input: WholeFilmNarrationInput) {
  const diagnostics = input.diagnostics?.filter(Boolean) || [];
  return [
    'Write the complete movie narration for a cinematic LifeStory film.',
    'Return the literal subtitles/voiceover the audience will hear, already split scene by scene.',
    '',
    'Creative direction:',
    '- Keep one narrator voice across the whole film.',
    '- Build emotional callbacks across scenes when the story gives you real material for them.',
    '- Write concise spoken lines that fit the scene duration and feel like a finished film.',
    '- Do not explain why the clip exists. Do not describe the planning logic, scene function, visual motif, profession, or location as production notes.',
    '- Do not invent generic biography. Use only the supplied user story, treatment, scene outline, and coverage briefs.',
    '',
    'Output JSON shape:',
    '{"voiceNotes":"optional diagnostic note","scenes":[{"sceneIndex":0,"narrationText":"one final spoken line"}]}',
    '',
    'Approved treatment:',
    treatmentLine(input.treatment),
    '',
    'Full story bucket:',
    input.storyContext || 'No story bucket context supplied.',
    '',
    'Ordered scene outline:',
    input.scenes.map(scenePromptBlock).join('\n\n---\n\n'),
    diagnostics.length ? `\nPrevious structural diagnostics to repair:\n${diagnostics.map((item) => `- ${item}`).join('\n')}` : '',
  ].filter((part) => part !== '').join('\n');
}

function normalizeNarrationObject(value: unknown): WholeFilmNarrationResult {
  return wholeFilmNarrationSchema.parse(value);
}

export function validateWholeFilmNarrationResult(
  rawResult: unknown,
  scenes: WholeFilmNarrationSceneInput[],
) {
  const diagnostics: string[] = [];
  let result: WholeFilmNarrationResult | null = null;

  try {
    result = normalizeNarrationObject(rawResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false as const, diagnostics: [`Malformed narration JSON: ${message}`] };
  }

  if (result.scenes.length !== scenes.length) {
    diagnostics.push(`Expected ${scenes.length} scene narration entries but received ${result.scenes.length}.`);
  }

  const expectedIndexes = scenes.map(sceneIndex);
  const expectedIndexSet = new Set(expectedIndexes);
  const seen = new Set<number>();
  for (const scene of result.scenes) {
    if (!Number.isInteger(scene.sceneIndex) || scene.sceneIndex < 0) {
      diagnostics.push(`Invalid sceneIndex ${scene.sceneIndex}; expected a non-negative integer from ${expectedIndexes.join(', ')}.`);
      continue;
    }
    if (!expectedIndexSet.has(scene.sceneIndex)) {
      diagnostics.push(`Unexpected sceneIndex ${scene.sceneIndex}; expected ${expectedIndexes.join(', ')}.`);
    }
    if (seen.has(scene.sceneIndex)) {
      diagnostics.push(`Duplicate narration for sceneIndex ${scene.sceneIndex}.`);
    }
    seen.add(scene.sceneIndex);
  }

  for (const expectedIndex of expectedIndexes) {
    if (!seen.has(expectedIndex)) {
      diagnostics.push(`Missing narration for sceneIndex ${expectedIndex}.`);
    }
  }

  for (const scene of scenes) {
    const index = sceneIndex(scene);
    const narration = result.scenes.find((entry) => entry.sceneIndex === index);
    const narrationText = cleanText(narration?.narrationText);
    if (!narrationText) {
      diagnostics.push(`Scene ${index + 1} narration is empty.`);
      continue;
    }

    const duration = Number(scene.duration) > 0 ? Number(scene.duration) : 5;
    const budget = narrationWordBudgetForDuration(duration);
    const words = wordCount(narrationText);
    if (words > budget) {
      diagnostics.push(`Scene ${index + 1} narration has ${words} words; budget is ${budget} for ${duration} seconds.`);
    }
  }

  if (diagnostics.length) {
    return { ok: false as const, diagnostics };
  }

  return {
    ok: true as const,
    result: {
      voiceNotes: result.voiceNotes,
      scenes: result.scenes
        .map((scene) => ({
          sceneIndex: scene.sceneIndex,
          narrationText: cleanText(scene.narrationText),
        }))
        .sort((a, b) => a.sceneIndex - b.sceneIndex),
    },
  };
}

async function generateWholeFilmNarrationObject(params: {
  prompt: string;
  openrouterApiKey: string;
  modelId?: string;
}) {
  const { object } = await generateObject({
    model: createOpenRouterModel(params.openrouterApiKey, params.modelId || DEFAULT_WHOLE_FILM_NARRATION_MODEL),
    maxOutputTokens: MAX_WHOLE_FILM_NARRATION_OUTPUT_TOKENS,
    schema: wholeFilmNarrationSchema,
    system: [
      'You are the voiceover writer for a cinematic personal documentary.',
      'Write only final audience-facing narration in the requested JSON schema.',
      'The narration must be emotionally specific, concise, and spoken aloud naturally.',
    ].join(' '),
    prompt: params.prompt,
  });
  return object;
}

export async function planWholeFilmNarration(input: WholeFilmNarrationPlannerInput): Promise<WholeFilmNarrationResult> {
  const maxAttempts = Math.max(1, input.maxAttempts || 2);
  let diagnostics = input.diagnostics?.filter(Boolean) || [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const prompt = buildWholeFilmNarrationPrompt({ ...input, diagnostics });
    let rawResult: unknown;
    try {
      rawResult = input.generateNarrationObject
        ? await input.generateNarrationObject({ prompt, diagnostics, attempt })
        : input.openrouterApiKey
          ? await generateWholeFilmNarrationObject({
            prompt,
            openrouterApiKey: input.openrouterApiKey,
            modelId: input.modelId,
          })
          : (() => {
            throw new Error('OpenRouter API key is required for whole-film narration planning.');
          })();
    } catch (error) {
      diagnostics = [`Malformed narration JSON or OpenRouter response: ${error instanceof Error ? error.message : String(error)}`];
      continue;
    }

    const validation = validateWholeFilmNarrationResult(rawResult, input.scenes);
    if (validation.ok) return validation.result;
    diagnostics = validation.diagnostics;
  }

  throw new Error(`Whole-film narration failed: ${diagnostics.join(' ') || 'No valid narration was produced.'}`);
}
