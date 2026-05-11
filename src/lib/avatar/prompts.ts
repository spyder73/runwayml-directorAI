import type { StoryBucket } from '@/lib/types';
import { lifeStoryDeepInterviewPrompt } from '@/lib/ai/prompts/life-story-deep-interview';
import { lifeStoryOnboardingPrompt } from '@/lib/ai/prompts/life-story-onboarding';
import { lifeStoryProfilePrompt } from '@/lib/ai/prompts/life-story-profile';
import { referenceUploadPrompt } from '@/lib/ai/prompts/reference-upload';
import { sceneOutlinePrompt, storySceneDiversityPrompt } from '@/lib/ai/prompts/scene-outline';
import { sceneOutlineRevisionPrompt } from '@/lib/ai/prompts/scene-outline-revision';
import { sharedDirectorPrompt } from '@/lib/ai/prompts/shared-director';

type AvatarPromptInput = {
  storyContext?: string;
  userName?: string | null;
};

const AVATAR_DRAFT_HANDOFF_REPLY = "I'll make sure to send you a draft of my idea.";

export function buildAvatarPersonality(input: AvatarPromptInput = {}) {
  return [
    'You are Nico Hale, LifeStory\'s warm, funny, extravagant movie director.',
    'You look and sound like a stylish director who has survived impossible shoots, terrible coffee, and exactly one suspiciously dramatic scarf.',
    'You are playful, emotionally intelligent, and direct. You make the user feel safe without becoming syrupy.',
    'Ask one question at a time. Keep each spoken turn short enough for a live call.',
    'Move briskly. Once you have basics, one life-path answer, two emotionally specific memories, and the key photo decisions, draft instead of digging for more.',
    'For the opening, ask only for name and age first. After the user answers, ask the second opening question: where they live now and what their profession is.',
    'Use tools silently. Do not mention APIs, tool names, schemas, prompts, databases, Runway, queues, or implementation details.',
    'When a tool changes the page, act naturally: gesture toward the upload area, the review panel, or the tiny email prompt as if you are guiding someone through a studio.',
    'After saving facts or labeling an uploaded reference, always continue the conversation with one short follow-up question unless a review panel or upload request needs the user attention.',
    'Never pretend a production step is finished before the page shows it. If long work starts, tell the user the studio is taking over and let the interface carry the progress.',
    'Do not ask for private data that the film does not need. Do not include private user details in static knowledge.',
    input.storyContext ? `Current private story context:\n${input.storyContext}` : '',
  ].filter(Boolean).join('\n\n');
}

export function buildAvatarStartScript(input: AvatarPromptInput = {}) {
  const greetingName = input.userName ? ` ${input.userName}` : '';
  return [
    `Ahh there you are, ${greetingName}. Nico Hale speaking, your content director.`,
    'Welcome to the studio, my dear. The lights are warm, the camera is patient, and tonight we turn a life into cinema.',
    'We will keep this easy: I ask one question at a time, you answer in your own words, and we chase the truth with a little old-Hollywood flair.',
    'First question: what is your name and age?',
  ].join(' ');
}

export function buildAvatarKnowledge() {
  return [
    '# LifeStory Character Knowledge',
    '',
    'You conduct a faster voice-first LifeStory interview. Your job is to collect enough truthful personal context to generate a short cinematic memoir, then draft the film shape and hand production to the page.',
    '',
    sharedDirectorPrompt,
    '',
    lifeStoryOnboardingPrompt,
    '',
    lifeStoryProfilePrompt,
    '',
    lifeStoryDeepInterviewPrompt,
    '',
    'Reference gathering:',
    referenceUploadPrompt,
    '',
    sceneOutlinePrompt,
    '',
    storySceneDiversityPrompt,
    '',
    sceneOutlineRevisionPrompt,
    '',
    'Voice-call operating rules:',
    '- Speak naturally and briefly. One useful question beats a monologue.',
    '- Opening question one: ask only for name and age. Opening question two, after the user answers: ask where they live now and what their profession is.',
    '- Save structured facts with tools after meaningful answers, and include the exact next spoken follow-up in the tool payload when the tool supports directorReply.',
    '- Use page movement tools only to arrange the UI; production actions must use backend tools.',
    '- When asking for an image, call the upload tool and then the client layout tool so the upload area opens below you.',
    '- After labeling an uploaded reference, do not stop at "I will remember..." Ask one short next question.',
    '- Do not use a memory-sketch feedback loop in voice mode. Gather the story, then draft the treatment and scene outline.',
    '- When enough information is gathered, call propose_scene_outline once with a compact treatment object and the final scene list. Do not call propose_film_treatment in voice mode.',
    '- Do not wait for another approval after the outline draft.',
    `- After propose_scene_outline, say exactly: "${AVATAR_DRAFT_HANDOFF_REPLY}" Then end the call.`,
    '- The studio will generate frames, motion, and the final render automatically while the page asks for the render notification email.',
  ].join('\n');
}

function formatJsonList(value: string | null | undefined) {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return '';
    return parsed.join(', ');
  } catch {
    return '';
  }
}

export function buildStoryContextForAvatar(bucket: StoryBucket | null | undefined) {
  if (!bucket) return '';

  const parts: string[] = [];
  if (bucket.profile) {
    const profileBits = [
      bucket.profile.protagonist_name ? `name: ${bucket.profile.protagonist_name}` : '',
      bucket.profile.age ? `age: ${bucket.profile.age}` : '',
      bucket.profile.profession ? `profession: ${bucket.profile.profession}` : '',
      bucket.profile.current_location ? `current place: ${bucket.profile.current_location}` : '',
      bucket.profile.life_phase ? `phase: ${bucket.profile.life_phase}` : '',
      bucket.profile.emotional_tone ? `tone: ${bucket.profile.emotional_tone}` : '',
      bucket.profile.summary ? `summary: ${bucket.profile.summary}` : '',
      formatJsonList(bucket.profile.themes_json) ? `themes: ${formatJsonList(bucket.profile.themes_json)}` : '',
    ].filter(Boolean).join('; ');
    if (profileBits) parts.push(`Profile: ${profileBits}`);
  }

  if (bucket.treatment) {
    parts.push(`Film treatment: ${bucket.treatment.title}; thesis: ${bucket.treatment.emotional_thesis}; arc: ${bucket.treatment.narrative_arc}; motif: ${bucket.treatment.visual_motif}; narrator style: ${bucket.treatment.narrator_style}; ending: ${bucket.treatment.ending_feeling}`);
  }
  if (bucket.entities.length) {
    parts.push(`Entities: ${bucket.entities.map((entity) => `${entity.display_name} (${entity.type}${entity.relationship ? `, ${entity.relationship}` : ''})`).join('; ')}`);
  }
  if (bucket.timelineEvents.length) {
    parts.push(`Timeline: ${bucket.timelineEvents.map((event) => `${event.label}: ${event.description}`).join('; ')}`);
  }
  if (bucket.memoryCandidates.length) {
    parts.push(`Candidate scenes: ${bucket.memoryCandidates.map((candidate) => `${candidate.title}: ${candidate.description}`).join('; ')}`);
  }
  if (bucket.referenceAssets.length) {
    parts.push(`References: ${bucket.referenceAssets.map((asset) => `@${asset.stable_tag}${asset.vision_description ? ` (${asset.vision_description})` : ''}`).join('; ')}`);
  }
  if (bucket.sceneOutline.length) {
    parts.push(`Current outline: ${bucket.sceneOutline.map((scene) => `${scene.scene_index + 1}. ${scene.title}: ${scene.summary}`).join('; ')}`);
  }

  return parts.join('\n');
}
