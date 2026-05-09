import type { SessionStatus } from './types';

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
- Do not repeat the previous assistant question if the user answered it.
- Keep the tone warm, cinematic, curious, and specific.
- Do not mention private notes, storage, tools, or implementation details.`;
}
