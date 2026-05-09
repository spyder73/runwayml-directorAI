import db from './db';
import { broadcastSessionUpdate } from './sse';
import { generateText, tool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import RunwayML from '@runwayml/sdk';
import { runFinalGenerationPhase } from './pipeline_final';
import type { ChatHistoryRow, InterviewMessage, SceneRow, SessionRow } from './types';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const runwayClient = new RunwayML({
  apiKey: process.env.RUNWAYML_API_SECRET || '', 
});

const transitionQuestionSchema = z.object({ next_question: z.string().optional() });
const transitionAnnouncementSchema = z.object({ announcement: z.string().optional() });
const protagonistRequestSchema = z.object({ request_text: z.string().optional() });
const memorySketchSchema = z.object({ 
  visual_prompt: z.string().optional(),
  chat_message: z.string().optional() 
});
const lockScriptSchema = z.object({
  scenes: z.array(z.object({
    narrator_text: z.string().optional(),
    video_prompt: z.string().optional(),
    image_prompt: z.string().optional(),
    duration: z.number().optional(),
  })).optional(),
});

function getToolCall(call: unknown) {
  if (typeof call !== 'object' || call === null) {
    return { toolName: '', input: {} };
  }

  const record = call as Record<string, unknown>;
  const toolName = typeof record.toolName === 'string' ? record.toolName : '';
  const input = record.args ?? record.input ?? record.parameters ?? {};
  return { toolName, input };
}

export async function processInterviewTurn(sessionId: string) {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const historyRows = db.prepare('SELECT role, content FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Pick<ChatHistoryRow, 'role' | 'content'>[];
    const messages: InterviewMessage[] = historyRows.map((row) => ({
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: row.content,
    }));

    const systemPrompt = `You are a visionary film director working with a person to adapt their life story into a cinematic documentary. 
You are currently in the interview phase.
Your tone should be cinematic, thoughtful, deeply curious, and highly empathetic. You are NOT a technical assistant. 
Do not say things like "upload a scene reference image" or "I am an AI." Speak like a human director casting a film.
Avoid overly technical questions about "lighting", "lens choice", or "camera angles". Focus on emotion, story, narrative arcs, and specific sensory memories (what did the room look like? what color was the car?).

Current Session Status: ${session.status}

Based on the conversation so far, decide what to do next.

If the status is INTERVIEW_ONBOARDING: 
  - Introduce yourself and ask how in-depth they want their life story to be told (e.g. short summary, focus on key milestones, or a deep dive). Provide [OPTIONS] for them to choose.
  - If you have their basic info and depth preference, you MUST use the \`transition_to_psych_profile\` tool.

If the status is INTERVIEW_PSYCH_PROFILE: 
  - Ask deep, emotional questions. Only ask one question at a time.
  - Once you've explored 2-3 profound moments, you MUST use \`transition_to_dynamic_interview\` tool.

If the status is INTERVIEW_DYNAMIC: 
  - Explore their memories. Ask follow up questions to get visual details. 
  - Use the \`generate_memory_sketch\` tool to show them mockups of scenes they describe to see if you got it right.
  - Once you feel you have a strong, emotional narrative arc with clear visual scenes, use \`transition_to_pre_production\`. (Summarize the story so far and immediately ask the first pre-production question).

If the status is PRE_PRODUCTION: 
  - You are building scenes internally. 
  - Ask the user for specific photos related to the scenes you are building (e.g., "Do you have a picture of that red Honda Civic?"). 
  - Once you have asked for a few key props/people and the user has answered, you MUST use \`request_protagonist_photo\`.

If the status is AWAITING_SELFIE: 
  - Just politely wait for the user to provide their photo. Once they provide it (or say they did, or you see an image uploaded message), use \`lock_script_and_proceed\` to finalize the scenes.

MULTIPLE CHOICE OPTIONS:
If you want to offer the user multiple choice answers for your question, output them at the very end of your message in this exact format:
[OPTIONS] Option A | Option B | Option C

For example:
"How deep would you like to go into your story?"
[OPTIONS] Just a quick summary | Let's focus on my childhood | I want a deep dive into every era
`;

    const { text, toolCalls } = await generateText({
      model: openrouter('google/gemini-3.1-flash-lite'),
      system: systemPrompt,
      messages,
      tools: {
        transition_to_psych_profile: tool({
          description: 'Move to the psychological profiling phase. Use this when you have basic info (name, age).',
          inputSchema: z.object({
            next_question: z.string().describe('The first deep question to ask the user.'),
          }),
        }),
        transition_to_dynamic_interview: tool({
          description: 'Move to the dynamic exploration phase after the 4 core questions are answered.',
          inputSchema: z.object({
            next_question: z.string().describe('The first dynamic exploration question.'),
          }),
        }),
        transition_to_pre_production: tool({
          description: 'Move to asset gathering when you have enough story for a film.',
          inputSchema: z.object({
            announcement: z.string().describe('What you say to the user to announce we are moving to pre-production and starting to gather assets.'),
          }),
        }),
        request_protagonist_photo: tool({
          description: 'Ask the user to provide a selfie to act as the main character. Use this at the end of pre-production.',
          inputSchema: z.object({
            request_text: z.string().describe('The message asking for their picture.'),
          }),
        }),
        generate_memory_sketch: tool({
          description: 'Generate a mockup image to verify a visual detail with the user.',
          inputSchema: z.object({
            visual_prompt: z.string().describe('A detailed visual description of the scene to generate.'),
            chat_message: z.string().describe('The message to send alongside the image.'),
          }),
        }),
        lock_script_and_proceed: tool({
          description: 'Finalize the film script and begin generation. Use only after getting the selfie.',
          inputSchema: z.object({
            scenes: z.array(z.object({
              narrator_text: z.string().describe('The voiceover for the scene. Will be spoken by Bernard.'),
              video_prompt: z.string().describe('Detailed prompt for the video generator.'),
              image_prompt: z.string().describe('Detailed prompt for the image generator (used as base for video).'),
              duration: z.number().min(2).max(10).describe('The duration of the scene in seconds (2 to 10).'),
              is_protagonist_visible: z.boolean().describe('Should the user (selfie) be visible in this scene?'),
            })).min(3).max(6),
          }),
        })
      }
    });

    let finalReply = text;

    if (toolCalls && toolCalls.length > 0) {
      for (const rawCall of toolCalls) {
        const call = getToolCall(rawCall);

        if (call.toolName === 'transition_to_psych_profile') {
           const args = transitionQuestionSchema.parse(call.input);
           db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('INTERVIEW_PSYCH_PROFILE', sessionId);
           finalReply = args.next_question || text || "Could you tell me a bit more about your background?";
        } else if (call.toolName === 'transition_to_dynamic_interview') {
           const args = transitionQuestionSchema.parse(call.input);
           db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('INTERVIEW_DYNAMIC', sessionId);
           finalReply = args.next_question || text || "Let's dive deeper into that memory. What do you see?";
        } else if (call.toolName === 'transition_to_pre_production') {
           const args = transitionAnnouncementSchema.parse(call.input);
           db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('PRE_PRODUCTION', sessionId);
           finalReply = args.announcement || text || "This is great. Let's start building the scenes.";
        } else if (call.toolName === 'request_protagonist_photo') {
           const args = protagonistRequestSchema.parse(call.input);
           db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('AWAITING_SELFIE', sessionId);
           finalReply = args.request_text || text || "Before we finalize, could you share a photo of yourself to serve as our main character?";
        } else if (call.toolName === 'generate_memory_sketch') {
           const args = memorySketchSchema.parse(call.input);
           let imageUrl = `https://picsum.photos/seed/${Math.random()}/800/450`; // fallback
           try {
             if (process.env.RUNWAYML_API_SECRET) {
               const ratio = session.aspect_ratio === '9:16' ? '1088:1920' : '1920:1088';
               const task = await runwayClient.textToImage.create({
                 // @ts-ignore
                 model: 'gpt_image_2',
                 promptText: args.visual_prompt || "Cinematic memory sketch",
                 quality: 'low',
                 ratio: ratio as any,
               }).waitForTaskOutput();
               if (task.output && task.output[0]) {
                 imageUrl = task.output[0];
               }
             }
           } catch (e) {
             console.error("RunwayML Sketch Error:", e);
           }
           finalReply = (args.chat_message || text || "Here is a quick mockup of that scene.") + `\n\n[Mockup: ${imageUrl}]`;
        } else if (call.toolName === 'lock_script_and_proceed') {
           const args = lockScriptSchema.parse(call.input);
           const insertScene = db.prepare(`
              INSERT INTO scenes (id, session_id, scene_index, narrator_text, visual_prompt, video_prompt, image_prompt, duration, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const trx = db.transaction(() => {
              if (args.scenes && Array.isArray(args.scenes)) {
                args.scenes.forEach((scene, index) => {
                  insertScene.run(uuidv4(), sessionId, index, scene.narrator_text || '', scene.video_prompt || '', scene.video_prompt || '', scene.image_prompt || '', scene.duration || 5, 'pending');
                });
              }
              db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('GENERATING_FINAL_ASSETS', sessionId);
            });
            trx();

            runFinalGenerationPhase(sessionId).catch(console.error);

            finalReply = "Perfect. The cameras are rolling. I'm stitching your life into a cinematic piece now.";
        }
      }
    }

    if (finalReply) {
      let optionsStr = null;
      const optionsMatch = finalReply.match(/\[OPTIONS\]([\s\S]*)/i);
      if (optionsMatch) {
        const optionsList = optionsMatch[1].split('|').map(o => o.trim()).filter(Boolean);
        optionsStr = JSON.stringify(optionsList);
        finalReply = finalReply.replace(/\[OPTIONS\]([\s\S]*)/i, '').trim();
      }

      // Save assistant message
      db.prepare('INSERT INTO chat_history (id, session_id, role, content, options) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), sessionId, 'assistant', finalReply, optionsStr);

      const sessionUpdate = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      
      broadcastSessionUpdate(sessionId, { 
          session: sessionUpdate as SessionRow,
          chat_history: db.prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatHistoryRow[],
          scenes: db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[],
      });
    }

  } catch (error) {
    console.error('Interview turn failed:', error);
  }
}
