const WORDS_PER_SECOND = 2.2;
const MIN_NARRATION_WORDS = 4;

export function narrationWordBudgetForDuration(durationSeconds: number | null | undefined) {
  const duration = Number.isFinite(durationSeconds) && durationSeconds && durationSeconds > 0
    ? durationSeconds
    : 5;
  return Math.max(MIN_NARRATION_WORDS, Math.floor(duration * WORDS_PER_SECOND));
}

export function limitNarrationForSceneDuration(text: string, durationSeconds: number | null | undefined) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return normalized;

  const budget = narrationWordBudgetForDuration(durationSeconds);
  const words = normalized.split(/\s+/);
  if (words.length <= budget) return normalized;

  const limitedWords = words.slice(0, budget);
  const lastWord = limitedWords[limitedWords.length - 1] || '';
  if (/[.!?]$/.test(lastWord)) {
    return limitedWords.join(' ');
  }

  limitedWords[limitedWords.length - 1] = lastWord.replace(/[,:;]+$/, '');
  return `${limitedWords.join(' ')}.`;
}

