import {
  MAX_REFERENCE_IMAGES_PER_RUNWAY_REQUEST,
  MAX_RUNWAY_VIDEO_SECONDS,
  MIN_RUNWAY_VIDEO_SECONDS,
} from './production-config';

export type PromptLintResult = {
  ok: boolean;
  errors: string[];
  promptTags: string[];
};

export type PromptReferenceImage = {
  tag?: string;
  uri: string;
};

const TAG_PATTERN = /^[a-z][a-z0-9_]{2,15}$/;
const TAG_CAPTURE_PATTERN = /@([a-zA-Z][a-zA-Z0-9_]*)/g;
const PRIVATE_NOTE_PATTERN = /\b(sourceTurnId|story bucket|private story context|tool call|api key|implementation note|confidence score)\b/i;
const NEGATIVE_PROMPT_PATTERN = /\b(do not|don't|without showing|no visible|avoid showing|must not)\b/i;
const MOTION_PATTERN = /\b(camera|pushes?|pulls?|pans?|tilts?|tracks?|dollies?|zooms?|moves?|drifts?|passes?|turns?|walks?|runs?|looks?|breathes?|exhales?|falls?|rises?|opens?|closes?|flickers?|shifts?|sways?|glides?|reveals?)\b/i;

function extractPromptTags(promptText: string) {
  return [...promptText.matchAll(TAG_CAPTURE_PATTERN)].map((match) => match[1]);
}
function basePromptErrors(promptText: string) {
  const errors: string[] = [];
  if (!promptText.trim()) errors.push('Prompt text is required.');
  if (PRIVATE_NOTE_PATTERN.test(promptText)) errors.push('Prompt contains private implementation notes.');
  if (NEGATIVE_PROMPT_PATTERN.test(promptText)) errors.push('Prompt should use positive descriptions instead of negative prompt language.');
  return errors;
}

export function lintRunwayImagePrompt(params: {
  promptText: string;
  referenceImages?: PromptReferenceImage[];
}): PromptLintResult {
  const referenceImages = params.referenceImages || [];
  const errors = basePromptErrors(params.promptText);
  const promptTags = extractPromptTags(params.promptText);
  const referenceTags = referenceImages.map((image) => image.tag).filter((tag): tag is string => Boolean(tag));

  if (referenceImages.length > MAX_REFERENCE_IMAGES_PER_RUNWAY_REQUEST) {
    errors.push(`Runway image prompts can include at most ${MAX_REFERENCE_IMAGES_PER_RUNWAY_REQUEST} reference images.`);
  }

  for (const tag of referenceTags) {
    if (!TAG_PATTERN.test(tag)) {
      errors.push(`Reference tag @${tag} must be lowercase, start with a letter, and be 3-16 characters.`);
    }
  }

  for (const tag of promptTags) {
    if (!referenceTags.includes(tag)) {
      errors.push(`Prompt references @${tag}, but no included reference image has that tag.`);
    }
  }

  for (const tag of referenceTags) {
    if (!promptTags.includes(tag)) {
      errors.push(`Reference image @${tag} is included but missing from prompt text.`);
    }
  }

  return { ok: errors.length === 0, errors, promptTags };
}

export function assertRunwayImagePrompt(params: Parameters<typeof lintRunwayImagePrompt>[0]) {
  const result = lintRunwayImagePrompt(params);
  if (!result.ok) {
    throw new Error(`Image prompt failed validation: ${result.errors.join(' ')}`);
  }
  return result;
}

export function lintRunwayVideoPrompt(params: {
  promptText: string;
  durationSeconds: number;
}): PromptLintResult {
  const errors = basePromptErrors(params.promptText);
  const promptTags = extractPromptTags(params.promptText);
  if (promptTags.length) {
    errors.push('Video motion prompts should not contain @tag references; the input frame carries identity and composition.');
  }
  if (!Number.isFinite(params.durationSeconds) || params.durationSeconds < MIN_RUNWAY_VIDEO_SECONDS || params.durationSeconds > MAX_RUNWAY_VIDEO_SECONDS) {
    errors.push(`Video duration must be between ${MIN_RUNWAY_VIDEO_SECONDS} and ${MAX_RUNWAY_VIDEO_SECONDS} seconds.`);
  }
  if (!MOTION_PATTERN.test(params.promptText)) {
    errors.push('Video prompt must describe motion, camera movement, or action.');
  }
  return { ok: errors.length === 0, errors, promptTags };
}

export function assertRunwayVideoPrompt(params: Parameters<typeof lintRunwayVideoPrompt>[0]) {
  const result = lintRunwayVideoPrompt(params);
  if (!result.ok) {
    throw new Error(`Video prompt failed validation: ${result.errors.join(' ')}`);
  }
  return result;
}
