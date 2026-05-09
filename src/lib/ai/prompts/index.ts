import type { ReferenceUploadRequestRow, SessionMode, SessionStatus } from '@/lib/types';
import { lifeStoryDeepInterviewPrompt } from './life-story-deep-interview';
import { lifeStoryOnboardingPrompt } from './life-story-onboarding';
import { lifeStoryProfilePrompt } from './life-story-profile';
import { memoryFastInterviewPrompt } from './memory-fast-interview';
import { referenceUploadPrompt } from './reference-upload';
import { sceneOutlinePrompt } from './scene-outline';
import { sceneOutlineRevisionPrompt } from './scene-outline-revision';
import { sharedDirectorPrompt } from './shared-director';
import { sketchFeedbackPrompt } from './sketch-feedback';

export type InterviewPromptInput = {
  mode: SessionMode;
  status: SessionStatus;
  storyContext: string;
  uploadContext: string;
  activeReferenceRequest: ReferenceUploadRequestRow | null;
};

function phasePrompt(mode: SessionMode, status: SessionStatus) {
  if (mode === 'single_memory') return memoryFastInterviewPrompt;
  if (status === 'INTERVIEW_ONBOARDING') return lifeStoryOnboardingPrompt;
  if (status === 'INTERVIEW_PSYCH_PROFILE') return lifeStoryProfilePrompt;
  return lifeStoryDeepInterviewPrompt;
}

export function buildInterviewSystemPrompt(input: InterviewPromptInput) {
  const activeReference = input.activeReferenceRequest
    ? `Active optional image request: ${input.activeReferenceRequest.target_label}. If the user skips it, ask for visual details instead.`
    : 'No active optional image request.';

  const privateContext = [
    input.storyContext ? `Private story context:\n${input.storyContext}` : '',
    input.uploadContext ? `Private image notes:\n${input.uploadContext}` : '',
    activeReference,
  ].filter(Boolean).join('\n\n');

  return [
    sharedDirectorPrompt,
    phasePrompt(input.mode, input.status),
    referenceUploadPrompt,
    sketchFeedbackPrompt,
    sceneOutlinePrompt,
    sceneOutlineRevisionPrompt,
    `Current interview phase: ${input.status}.`,
    privateContext,
  ].filter(Boolean).join('\n\n');
}
