export const NARRATION_TAIL_PAD_SECONDS = 0.3;

function finitePositive(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function visualDurationWithNarrationTail(
  plannedVisualDuration: number | null | undefined,
  narrationDuration: number | null | undefined,
) {
  const visualDuration = finitePositive(plannedVisualDuration) || 0;
  const spokenDuration = finitePositive(narrationDuration);
  if (!spokenDuration) return Math.max(visualDuration, 1);
  return Math.max(visualDuration, spokenDuration + NARRATION_TAIL_PAD_SECONDS);
}
