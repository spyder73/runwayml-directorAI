import { generateText } from 'ai';
import { createOpenRouterModel } from './ai';
import { ensureRunwayVideoPromptMotion, lintRunwayVideoPrompt } from './prompt-lint';

export const MAX_VIDEO_PROMPT_REPAIR_OUTPUT_TOKENS = 512;

type RepairGeneratorInput = {
  promptText: string;
  validationError: string;
};

type RepairGenerator = (input: RepairGeneratorInput) => Promise<string>;

type RepairInput = {
  promptText: string;
  durationSeconds: number;
  validationError?: string;
  openrouterApiKey?: string;
  generateRepairText?: RepairGenerator;
};

type RepairResult = {
  promptText: string;
  repaired: boolean;
  validationError: string | null;
};

function cleanRepairText(value: string) {
  return value
    .replace(/```(?:text|txt)?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*(?:repaired prompt|prompt)\s*:\s*/i, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

function deterministicVideoPromptRepair(promptText: string) {
  const withoutReferenceInstructions = promptText
    .replace(/\b(?:use|using|include|including|reference|referencing)\s+[^.!?]*@[a-zA-Z][a-zA-Z0-9_]*[^.!?]*[.!?]?/gi, ' ')
    .replace(/@[a-zA-Z][a-zA-Z0-9_]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return ensureRunwayVideoPromptMotion(withoutReferenceInstructions || 'The camera moves through the scene with natural atmospheric motion.');
}

async function defaultRepairGenerator(input: RepairGeneratorInput & { openrouterApiKey: string }) {
  const { text } = await generateText({
    model: createOpenRouterModel(input.openrouterApiKey, 'google/gemini-3.1-flash-lite'),
    maxOutputTokens: MAX_VIDEO_PROMPT_REPAIR_OUTPUT_TOKENS,
    system: [
      'You repair Runway image-to-video motion prompts.',
      'Return only one rewritten prompt, no markdown and no explanation.',
      'The prompt must not contain @tag references; the input frame already carries identity and composition.',
      'Preserve the people, place, mood, and action in plain language.',
      'Describe visible motion, camera movement, or action.',
    ].join(' '),
    prompt: [
      `Validation error: ${input.validationError}`,
      `Original prompt: ${input.promptText}`,
      'Rewrite it as a valid concise video motion prompt.',
    ].join('\n\n'),
  });

  return text;
}

export async function repairRunwayVideoPromptForValidation(input: RepairInput): Promise<RepairResult> {
  const initialPrompt = ensureRunwayVideoPromptMotion(input.promptText);
  const initialLint = lintRunwayVideoPrompt({
    promptText: initialPrompt,
    durationSeconds: input.durationSeconds,
  });

  if (initialLint.ok) {
    return { promptText: initialPrompt, repaired: false, validationError: null };
  }

  const validationError = input.validationError || initialLint.errors.join(' ');
  const fallbackPrompt = deterministicVideoPromptRepair(initialPrompt);

  try {
    const rawRepair = input.generateRepairText
      ? await input.generateRepairText({ promptText: initialPrompt, validationError })
      : input.openrouterApiKey
        ? await defaultRepairGenerator({ promptText: initialPrompt, validationError, openrouterApiKey: input.openrouterApiKey })
        : fallbackPrompt;

    const repairedPrompt = ensureRunwayVideoPromptMotion(cleanRepairText(rawRepair));
    const repairedLint = lintRunwayVideoPrompt({
      promptText: repairedPrompt,
      durationSeconds: input.durationSeconds,
    });

    if (repairedLint.ok) {
      return { promptText: repairedPrompt, repaired: true, validationError };
    }
  } catch (error) {
    console.warn('Video prompt repair failed; using deterministic repair fallback.', error);
  }

  return { promptText: fallbackPrompt, repaired: true, validationError };
}
