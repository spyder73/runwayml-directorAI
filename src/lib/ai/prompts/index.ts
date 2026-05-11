import type { ReferenceUploadRequestRow, SessionStatus } from '@/lib/types';
import { lifeStoryDeepInterviewPrompt } from './life-story-deep-interview';
import { lifeStoryOnboardingPrompt } from './life-story-onboarding';
import { lifeStoryProfilePrompt } from './life-story-profile';
import { referenceUploadPrompt } from './reference-upload';
import { sceneOutlinePrompt } from './scene-outline';
import { sceneOutlineRevisionPrompt } from './scene-outline-revision';
import { sharedDirectorPrompt } from './shared-director';
import { sketchFeedbackPrompt } from './sketch-feedback';

export type InterviewPromptInput = {
  status: SessionStatus;
  storyContext: string;
  uploadContext: string;
  activeReferenceRequest: ReferenceUploadRequestRow | null;
};

function phasePrompt(status: SessionStatus) {
  if (status === 'INTERVIEW_ONBOARDING') return lifeStoryOnboardingPrompt;
  if (status === 'INTERVIEW_PSYCH_PROFILE') return lifeStoryProfilePrompt;
  return lifeStoryDeepInterviewPrompt;
}

export function buildInterviewSystemPrompt(input: InterviewPromptInput) {
  const activeReference = input.activeReferenceRequest
    ? [
      `Active optional image request: ${input.activeReferenceRequest.target_label}.`,
      input.activeReferenceRequest.reason ? `What it is for: ${input.activeReferenceRequest.reason}.` : '',
      input.activeReferenceRequest.scene_title ? `Scene context: ${input.activeReferenceRequest.scene_title}.` : '',
      'If the user skips it, ask for visual details instead.',
    ].filter(Boolean).join(' ')
    : 'No active optional image request.';

  const privateContext = [
    input.storyContext ? `Private story context:\n${input.storyContext}` : '',
    input.uploadContext ? `Private image notes:\n${input.uploadContext}` : '',
    activeReference,
  ].filter(Boolean).join('\n\n');

  return [
    sharedDirectorPrompt,
    phasePrompt(input.status),
    referenceUploadPrompt,
    sketchFeedbackPrompt,
    sceneOutlinePrompt,
    sceneOutlineRevisionPrompt,
    `Current interview phase: ${input.status}.`,
    privateContext,
  ].filter(Boolean).join('\n\n');
}
