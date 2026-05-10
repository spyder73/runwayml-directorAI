import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const MAX_PROMPT_MODERATION_OUTPUT_TOKENS = 512;

export async function ensureSafePrompt(prompt: string): Promise<string> {
  if (!prompt.trim()) {
    throw new Error('Missing prompt text for generation.');
  }
  
  try {
    const { text } = await generateText({
      model: openrouter('google/gemini-3.1-flash-lite'),
      maxOutputTokens: MAX_PROMPT_MODERATION_OUTPUT_TOKENS,
      system: `You are a strict safety and content moderation filter for an AI video generation pipeline.
Your job is to read the provided prompt. 
If it is completely safe and passes standard AI safety filters (no extreme violence, no sexual content, no hate speech, no real-world sensitive political figures in compromising situations), just output "SAFE".
If it is potentially unsafe or might trigger API filters, rewrite it to be cinematic and structurally similar but completely safe. Keep it descriptive for video generation.`,
      prompt: `Please evaluate this prompt:\n\n${prompt}`,
    });

    const trimmed = text.trim();
    if (trimmed.toUpperCase() === 'SAFE') {
      return prompt;
    }
    return trimmed;
  } catch (error) {
    console.error('Error in ensureSafePrompt:', error);
    throw new Error('Prompt moderation failed before generation.');
  }
}
