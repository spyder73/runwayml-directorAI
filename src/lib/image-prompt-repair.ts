import { generateText } from 'ai';
import { createOpenRouterModel } from './ai';
import { lintRunwayImagePrompt, type PromptReferenceImage } from './prompt-lint';

export const MAX_IMAGE_PROMPT_REPAIR_OUTPUT_TOKENS = 512;

type RepairGeneratorInput = {
  promptText: string;
  validationError: string;
};

type RepairGenerator = (input: RepairGeneratorInput) => Promise<string>;

type RepairInput = {
  promptText: string;
  referenceImages?: PromptReferenceImage[];
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

function deterministicImagePromptRepair(promptText: string) {
  return promptText
    .replace(/\b(do not|don't|without showing|no visible|avoid showing|must not)\b/gi, 'focusing on')
    .replace(/\s+/g, ' ')
    .trim() || 'Cinematic life-story scene.';
}

async function defaultRepairGenerator(input: RepairGeneratorInput & { openrouterApiKey: string }) {
  const { text } = await generateText({
    model: createOpenRouterModel(input.openrouterApiKey, 'google/gemini-3.1-flash-lite'),
    maxOutputTokens: MAX_IMAGE_PROMPT_REPAIR_OUTPUT_TOKENS,
    system: [
      'You repair Runway image generation prompts.',
      'Return only one rewritten prompt, no markdown and no explanation.',
      'Rewrite this prompt to fix the validation error. Do not change anything else.',
      'Preserve the full story idea context, the identity references (@tags), and the exact cinematic meaning.',
      'If fixing negative language, describe what *should* be seen instead of what to avoid.',
    ].join(' '),
    prompt: [
      `Validation error: ${input.validationError}`,
      `Original prompt: ${input.promptText}`,
      'Rewrite it as a valid cinematic image prompt.',
    ].join('\n\n'),
  });

  return text;
}

export async function repairRunwayImagePromptForValidation(input: RepairInput): Promise<RepairResult> {
  const initialLint = lintRunwayImagePrompt({
    promptText: input.promptText,
    referenceImages: input.referenceImages,
  });

  if (initialLint.ok) {
    return { promptText: input.promptText, repaired: false, validationError: null };
  }

  const validationError = input.validationError || initialLint.errors.join(' ');
  const fallbackPrompt = deterministicImagePromptRepair(input.promptText);

  try {
    const rawRepair = input.generateRepairText
      ? await input.generateRepairText({ promptText: input.promptText, validationError })
      : input.openrouterApiKey
        ? await defaultRepairGenerator({ promptText: input.promptText, validationError, openrouterApiKey: input.openrouterApiKey })
        : fallbackPrompt;

    const repairedPrompt = cleanRepairText(rawRepair);
    const repairedLint = lintRunwayImagePrompt({
      promptText: repairedPrompt,
      referenceImages: input.referenceImages,
    });

    if (repairedLint.ok) {
      return { promptText: repairedPrompt, repaired: true, validationError };
    }
  } catch (error) {
    console.warn('Image prompt repair failed; using deterministic repair fallback.', error);
  }

  // Attempt the fallback, and ensure it lints
  const fallbackLint = lintRunwayImagePrompt({
      promptText: fallbackPrompt,
      referenceImages: input.referenceImages,
  });
  
  if (fallbackLint.ok) {
      return { promptText: fallbackPrompt, repaired: true, validationError };
  }

  // If even the fallback fails, we just return the original text and hope for the best, or it will throw in assert
  return { promptText: input.promptText, repaired: false, validationError };
}
