export const NARRATION_WORDS_PER_SECOND = 2.3;
export const MIN_NARRATION_WORDS = 6;

export function narrationWordBudgetForDuration(durationSeconds: number | null | undefined) {
  const duration = Number.isFinite(durationSeconds) && durationSeconds && durationSeconds > 0
    ? durationSeconds
    : 5;
  return Math.max(MIN_NARRATION_WORDS, Math.floor(duration * NARRATION_WORDS_PER_SECOND));
}

export function narrationWordCount(text: string) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return 0;
  return normalized.split(/\s+/).length;
}
