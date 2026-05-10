import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export type ShotPlan = {
  duration: number;
  prompt: string;
};

function splitDurationIntoShots(durationSeconds: number) {
  const totalDuration = Math.max(2, Math.ceil(durationSeconds));
  const shotCount = Math.max(1, Math.ceil(totalDuration / 10));
  const baseDuration = Math.floor(totalDuration / shotCount);
  let remainder = totalDuration - baseDuration * shotCount;

  return Array.from({ length: shotCount }, () => {
    const duration = baseDuration + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return Math.max(2, Math.min(10, duration));
  });
}

export function normalizeShotPlan(
  visualPrompt: string,
  durationSeconds: number,
  proposedShots?: ShotPlan[],
): ShotPlan[] {
  const totalDuration = Math.max(2, Math.ceil(durationSeconds));
  const safePrompt = visualPrompt.trim() || 'Cinematic emotional memory scene.';
  const boundedDurations = splitDurationIntoShots(totalDuration);

  if (!proposedShots?.length) {
    return boundedDurations.map((duration, index) => ({
      duration,
      prompt: index === 0 ? safePrompt : `${safePrompt} Alternate cinematic angle ${index + 1}.`,
    }));
  }

  return boundedDurations.map((duration, index) => ({
    duration,
    prompt: proposedShots[index]?.prompt?.trim() || proposedShots[proposedShots.length - 1]?.prompt?.trim() || safePrompt,
  }));
}

export async function planShots(visualPrompt: string, durationSeconds: number) {
  if (!process.env.OPENROUTER_API_KEY) {
     return normalizeShotPlan(visualPrompt, durationSeconds);
  }
  
  // ensure duration is at least 2, else give one shot
  if (durationSeconds < 2) {
      return normalizeShotPlan(visualPrompt, durationSeconds);
  }

  try {
    const { object } = await generateObject({
      model: openrouter('anthropic/claude-3-haiku'),
      system: `You are an AI Video Director. The user will provide a visual description of a scene and its total duration based on the audio voiceover length.
Your job is to decide if this scene should be one continuous shot or cut into multiple angles.
Since AI video generators work best between 2 to 10 seconds, you must break down the total duration into a list of shots.
Each shot must have a specific duration (between 2 and 10 seconds), and the sum of all shot durations must exactly equal the total duration provided.
For each shot, provide a slightly adjusted cinematic prompt to reflect the camera angle or action (e.g. "Close up of...", "Wide shot of...").`,
      prompt: `Visual Description: ${visualPrompt}\nTotal Duration: ${durationSeconds.toFixed(1)} seconds. Break this down into shots.`,
      schema: z.object({
        shots: z.array(z.object({
          duration: z.number().describe('Duration in seconds (2 to 10)'),
          prompt: z.string().describe('Cinematic prompt for this specific shot')
        }))
      })
    });
    
    return normalizeShotPlan(visualPrompt, durationSeconds, object.shots);
  } catch (error) {
    console.error('Error planning shots:', error);
    return normalizeShotPlan(visualPrompt, durationSeconds);
  }
}
