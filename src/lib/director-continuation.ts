import type { SessionStatus } from './types';
import type { StoryBucket } from './types';

type ContinuationInput = {
  status: SessionStatus;
  storyContext: string;
};

export function buildDirectorContinuationPrompt(input: ContinuationInput) {
  return `You just saved private interview notes. Now write the user-visible response as the Director.

Use the latest user answer and this private context:
${input.storyContext || 'No private notes yet.'}

Current phase: ${input.status}.

Requirements:
- Return only the visible response.
- Ask one fresh follow-up question.
- Anchor the question in a concrete detail the user already gave, such as a place, profession, book, show, relationship, memory, or life choice.
- Do not repeat the previous assistant question if the user answered it.
- Do not ask vague handoff questions like "What should we explore next?" or "What should we talk about next?"
- Keep the tone warm, cinematic, curious, and specific.
- Do not mention private notes, storage, tools, or implementation details.`;
}

function firstSentence(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)[0] || '';
}

function formatList(items: string[]) {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] || '';
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`;
}

export function buildContextualInterviewFollowUp(bucket: StoryBucket) {
  const profile = bucket.profile;
  const profileAnchors = [
    profile?.profession,
    profile?.current_location,
    firstSentence(profile?.summary),
  ].filter((value): value is string => Boolean(value));

  if (profileAnchors.length) {
    return `You mentioned ${formatList(profileAnchors.slice(0, 3))}. What moment made that part of your life feel important enough to belong in the film?`;
  }

  const latestMoment = bucket.memoryCandidates.at(-1);
  if (latestMoment) {
    return `In "${latestMoment.title}", what is one image, sound, or feeling that still comes back clearly?`;
  }

  const latestEvent = bucket.timelineEvents.at(-1);
  if (latestEvent) {
    return `You mentioned ${latestEvent.label}. What did that chapter change in you?`;
  }

  const latestEntity = bucket.entities.at(-1);
  if (latestEntity) {
    return `You mentioned ${latestEntity.display_name}. What should the film understand about that connection?`;
  }

  return 'Which earlier or later chapter would help explain who you are now?';
}

export function ensureProactiveDirectorReply(
  reply: string | null | undefined,
  options: { fallbackQuestion: string },
) {
  const trimmedReply = reply?.trim();
  const fallbackQuestion = options.fallbackQuestion.trim();

  if (!trimmedReply) return fallbackQuestion;
  if (/[?？]/.test(trimmedReply)) return trimmedReply;
  if (!fallbackQuestion) return trimmedReply;

  const normalizedReply = /[.!]$/.test(trimmedReply) ? trimmedReply : `${trimmedReply}.`;
  return `${normalizedReply} ${fallbackQuestion}`;
}
