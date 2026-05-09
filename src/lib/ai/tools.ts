import { tool } from 'ai';
import { z } from 'zod';

export const transitionQuestionSchema = z.object({ next_question: z.string().optional() });
export const transitionAnnouncementSchema = z.object({ announcement: z.string().optional() });
export const protagonistRequestSchema = z.object({ request_text: z.string().optional() });
export const memorySketchSchema = z.object({ 
  visual_prompt: z.string().optional(),
  chat_message: z.string().optional() 
});
export const lockScriptSchema = z.object({
  scenes: z.array(z.object({
    narrator_text: z.string().describe('The voiceover for the scene. Will be spoken by Bernard.'),
    video_prompt: z.string().describe('Detailed prompt for the video generator. Focus on movement, lighting, and cinematic quality.'),
    image_prompt: z.string().describe('Detailed prompt for the image generator (used as base for video). Describe the exact visual layout.'),
    duration: z.number().min(2).max(10).describe('Duration in seconds (2 to 10). Because each clip is max 10s, determine the amount of scenes dynamically based on the memory scale.'),
    is_protagonist_visible: z.boolean().describe('Should the user (selfie) be visible in this scene?'),
  })).min(1).describe('The sequence of scenes. The number of scenes should be highly dynamic depending on what is necessary to tell the story, knowing each generated scene is a maximum of 10 seconds long.'),
});

export const aiTools = {
  transition_to_psych_profile: tool({
    description: 'Move to the psychological profiling phase. Use this when you have basic info (name, age).',
    inputSchema: transitionQuestionSchema,
  }),
  transition_to_dynamic_interview: tool({
    description: 'Move to the dynamic exploration phase. Use after getting some initial background.',
    inputSchema: transitionQuestionSchema,
  }),
  transition_to_pre_production: tool({
    description: 'Move to asset gathering when you have enough story for a film.',
    inputSchema: transitionAnnouncementSchema,
  }),
  request_protagonist_photo: tool({
    description: 'Ask the user to provide a selfie to act as the main character. Use this at the end of pre-production.',
    inputSchema: protagonistRequestSchema,
  }),
  generate_memory_sketch: tool({
    description: 'Generate a mockup image to verify a visual detail with the user.',
    inputSchema: memorySketchSchema,
  }),
  lock_script_and_proceed: tool({
    description: 'Finalize the film script and begin generation. Use only after getting the selfie. Generate exactly as many scenes as needed to cover the narrative (each scene is max 10s).',
    inputSchema: lockScriptSchema,
  })
};

export function getToolCall(call: unknown) {
  if (typeof call !== 'object' || call === null) {
    return { toolName: '', input: {} };
  }
  const record = call as Record<string, unknown>;
  const toolName = typeof record.toolName === 'string' ? record.toolName : '';
  const input = record.args ?? record.input ?? record.parameters ?? {};
  return { toolName, input };
}
