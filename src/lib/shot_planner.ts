import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export async function planShots(visualPrompt: string, durationSeconds: number) {
  if (!process.env.OPENROUTER_API_KEY) {
     return [{ duration: durationSeconds, prompt: visualPrompt }];
  }
  
  // ensure duration is at least 2, else give one shot
  if (durationSeconds < 2) {
      return [{ duration: Math.max(durationSeconds, 2), prompt: visualPrompt }];
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
    
    // Safety check sum
    const sum = object.shots.reduce((acc, shot) => acc + shot.duration, 0);
    if (Math.abs(sum - durationSeconds) > 0.5) {
      console.warn(`Shot duration sum ${sum} does not match total ${durationSeconds}. Adjusting last shot.`);
      let currentSum = 0;
      for (let i = 0; i < object.shots.length - 1; i++) {
         currentSum += object.shots[i].duration;
      }
      object.shots[object.shots.length - 1].duration = Math.max(2, durationSeconds - currentSum);
    }
    
    return object.shots;
  } catch (error) {
    console.error('Error planning shots:', error);
    return [{ duration: durationSeconds, prompt: visualPrompt }];
  }
}
