import type { StoryBucket } from './types';

export type LifeStoryOutlineReadiness = {
  ready: boolean;
  missing: string[];
  nextQuestion: string;
  sceneReadinessScores: SceneReadinessScore[];
};

export type SceneReadinessScore = {
  candidateId: string;
  title: string;
  emotionalClarity: number;
  visualSpecificity: number;
  characterClarity: number;
  referenceCoverage: number;
  narrativeImportance: number;
  userApproval: number;
};

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function meaningfulMoments(bucket: StoryBucket) {
  return bucket.memoryCandidates.filter((candidate) => (
    hasText(candidate.description)
    && hasText(candidate.emotional_purpose)
  ));
}

function scoreText(value: unknown, strongPattern?: RegExp) {
  if (!hasText(value)) return 0;
  const text = String(value);
  if (strongPattern?.test(text)) return 0.9;
  return text.length >= 24 ? 0.75 : 0.55;
}

export function scoreMemoryCandidateReadiness(candidate: StoryBucket['memoryCandidates'][number], bucket: StoryBucket): SceneReadinessScore {
  const people = parseArray(candidate.people_json);
  const places = parseArray(candidate.places_json);
  const referencesNeeded = parseArray(candidate.references_needed_json);
  const hasAcceptedSketch = candidate.status === 'accepted' || candidate.sketch_feedback?.startsWith('accepted');
  const usableReferenceCount = bucket.referenceAssets.filter((asset) => asset.usage_permissions === 'allowed').length;

  return {
    candidateId: candidate.id,
    title: candidate.title,
    emotionalClarity: scoreText(candidate.emotional_purpose || candidate.description, /\b(fear|love|grief|joy|loneliness|freedom|shame|hope|gratitude|belonging|courage|loss|wonder)\b/i),
    visualSpecificity: scoreText(candidate.visual_summary, /\b(light|rain|window|street|kitchen|station|door|color|suitcase|table|floor|room|train|car|school|photo)\b/i),
    characterClarity: people.length || places.length || bucket.entities.length ? 0.85 : 0.45,
    referenceCoverage: referencesNeeded.length === 0 ? 0.7 : Math.min(1, usableReferenceCount / referencesNeeded.length),
    narrativeImportance: hasText(candidate.emotional_purpose) ? 0.8 : 0.5,
    userApproval: hasAcceptedSketch ? 1 : candidate.status === 'rejected' ? 0.1 : 0.5,
  };
}

export function evaluateLifeStoryOutlineReadiness(bucket: StoryBucket): LifeStoryOutlineReadiness {
  const missing: string[] = [];
  const timelineCount = bucket.timelineEvents.filter((event) => hasText(event.description)).length;
  const entityCount = bucket.entities.filter((entity) => hasText(entity.display_name)).length;
  const moments = meaningfulMoments(bucket);
  const sceneReadinessScores = moments.map((candidate) => scoreMemoryCandidateReadiness(candidate, bucket));

  if (!hasText(bucket.profile?.protagonist_name) || !hasText(bucket.profile?.age)) {
    missing.push('name and age');
  }
  if (!hasText(bucket.profile?.life_phase)) {
    missing.push('current life phase');
  }
  if (!hasText(bucket.profile?.summary)) {
    missing.push('broad life summary');
  }
  if (timelineCount < 3) {
    missing.push('broad life eras');
  }
  if (entityCount < 2) {
    missing.push('important relationships or places');
  }
  if (moments.length < 2) {
    missing.push('deeper emotionally specific moments');
  }

  const visualGap = sceneReadinessScores.find((score) => score.visualSpecificity < 0.7);
  const emotionalGap = sceneReadinessScores.find((score) => score.emotionalClarity < 0.7);
  const ready = missing.length === 0 && !visualGap && !emotionalGap;

  return {
    ready,
    missing,
    sceneReadinessScores,
    nextQuestion: ready
      ? 'Before I shape this into an outline, is there anything important we have not touched yet, or a personal story you especially want highlighted?'
      : visualGap
        ? `For "${visualGap.title}", what is one visual detail that still feels alive: the light, the room, an object, the street outside, or what someone was wearing?`
        : emotionalGap
          ? `For "${emotionalGap.title}", what feeling should the scene carry most clearly?`
      : `I need a little more of the broad shape before I make the outline: ${missing.join(', ')}. Which era should we open up next?`,
  };
}
