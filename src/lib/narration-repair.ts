import { generateText } from 'ai';
import { createOpenRouterModel } from './ai';
import { narrationWordBudgetForDuration, narrationWordCount } from './narration-budget';

export const MAX_NARRATION_REPAIR_OUTPUT_TOKENS = 220;

const PRODUCTION_NOTE_PATTERN = /\b(?:(?:to\s+)?(?:show|highlight|demonstrate|set|illustrate|explain)(?:ing|s)?|this\s+scene|the\s+purpose\s+of|we\s+show|to\s+tell\s+the\s+audience|to\s+make\s+clear|visual\s+motif:|profession:|location:)\b/i;

type NarrationRepairInput = {
  narrationText: string;
  durationSeconds: number | null | undefined;
  sceneTitle?: string | null;
  sceneSummary?: string | null;
  emotionalPurpose?: string | null;
  openrouterApiKey?: string;
  generateRepairText?: (input: { narrationText: string; validationError: string; maxWords: number }) => Promise<string>;
};

type NarrationRepairResult = {
  narrationText: string;
  repaired: boolean;
};

function normalizeNarration(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function cleanRepairText(value: string) {
  return value
    .replace(/```(?:text|txt)?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*(?:repaired narration|narration|line)\s*:\s*/i, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

export function lintNarrationForScene(params: { narrationText: string; durationSeconds: number | null | undefined }) {
  const narrationText = normalizeNarration(params.narrationText);
  const errors: string[] = [];
  if (!narrationText) {
    errors.push('Narration text is required.');
    return { ok: false, errors, maxWords: narrationWordBudgetForDuration(params.durationSeconds) };
  }

  if (PRODUCTION_NOTE_PATTERN.test(narrationText)) {
    errors.push('Narration sounds like production notes instead of movie voiceover.');
  }

  const maxWords = narrationWordBudgetForDuration(params.durationSeconds);
  const wordCount = narrationWordCount(narrationText);
  if (wordCount > maxWords) {
    errors.push(`Narration exceeds scene pacing budget (${wordCount} > ${maxWords} words).`);
  }

  return { ok: errors.length === 0, errors, maxWords };
}

async function defaultNarrationRepair(input: {
  openrouterApiKey: string;
  narrationText: string;
  validationError: string;
  maxWords: number;
  sceneTitle?: string | null;
  sceneSummary?: string | null;
  emotionalPurpose?: string | null;
}) {
  const { text } = await generateText({
    model: createOpenRouterModel(input.openrouterApiKey, 'google/gemini-3.1-flash-lite'),
    maxOutputTokens: MAX_NARRATION_REPAIR_OUTPUT_TOKENS,
    system: [
      'You repair one scene narration line for a cinematic life-story film.',
      'Return only the rewritten narration line, no markdown, no explanation.',
      'Keep it human, vivid, and story-driven.',
      'Do not write production-note language such as "to show", "to highlight", or "this scene".',
      `Keep the rewrite at or below ${input.maxWords} words so voiceover does not overlap this scene.`,
      'Preserve the scene meaning and emotional turn.',
    ].join(' '),
    prompt: [
      `Validation error: ${input.validationError}`,
      `Original narration: ${input.narrationText}`,
      input.sceneTitle ? `Scene title: ${input.sceneTitle}` : '',
      input.sceneSummary ? `Scene summary: ${input.sceneSummary}` : '',
      input.emotionalPurpose ? `Emotional purpose: ${input.emotionalPurpose}` : '',
      `Rewrite as one cinematic narration line with at most ${input.maxWords} words.`,
    ].filter(Boolean).join('\n\n'),
  });

  return text;
}

export async function repairNarrationForSceneDuration(input: NarrationRepairInput): Promise<NarrationRepairResult> {
  const narrationText = normalizeNarration(input.narrationText);
  const initialLint = lintNarrationForScene({ narrationText, durationSeconds: input.durationSeconds });
  if (initialLint.ok) {
    return { narrationText, repaired: false };
  }

  const validationError = initialLint.errors.join(' ');
  const maxWords = initialLint.maxWords;

  if (!input.generateRepairText && !input.openrouterApiKey) {
    throw new Error(`Narration requires repair but no OpenRouter key is available. ${validationError}`);
  }

  const rawRepair = input.generateRepairText
    ? await input.generateRepairText({ narrationText, validationError, maxWords })
    : await defaultNarrationRepair({
      openrouterApiKey: input.openrouterApiKey as string,
      narrationText,
      validationError,
      maxWords,
      sceneTitle: input.sceneTitle,
      sceneSummary: input.sceneSummary,
      emotionalPurpose: input.emotionalPurpose,
    });

  const repairedNarration = normalizeNarration(cleanRepairText(rawRepair));
  const repairedLint = lintNarrationForScene({ narrationText: repairedNarration, durationSeconds: input.durationSeconds });
  if (!repairedLint.ok) {
    throw new Error(`Narration repair failed validation: ${repairedLint.errors.join(' ')}`);
  }

  return { narrationText: repairedNarration, repaired: true };
}