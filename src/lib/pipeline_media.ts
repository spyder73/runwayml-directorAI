import { generateImagesPhase } from './pipeline_final';

export async function runMediaGenerationPhase(sessionId: string) {
  // Delegate to pipeline_final directly which handles the real image generation using Runway
  await generateImagesPhase(sessionId);
}
