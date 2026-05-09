import db from './db';
import { broadcastSessionUpdate } from './sse';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { v4 as uuidv4 } from 'uuid';
import RunwayML from '@runwayml/sdk';
import { generateImagesPhase } from './pipeline_final';
import type { ChatHistoryRow, InterviewMessage, SceneRow, SessionRow } from './types';
import { aiTools, getToolCall, transitionQuestionSchema, transitionAnnouncementSchema, protagonistRequestSchema, memorySketchSchema, lockScriptSchema } from './ai/tools';
import { modeASingleMemoryPrompt } from './ai/prompts/mode-a-single-memory';
import { modeBLifeStoryPrompt } from './ai/prompts/mode-b-life-story';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const runwayClient = new RunwayML({
  apiKey: process.env.RUNWAYML_API_SECRET || '', 
});

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

    let rawSystemPrompt = session.mode === 'single_memory' ? modeASingleMemoryPrompt : modeBLifeStoryPrompt;
    const systemPrompt = rawSystemPrompt.replace('{status}', session.status);

    const { text, toolCalls } = await generateText({
      model: openrouter('google/gemini-3.1-flash-lite'),
      system: systemPrompt,
      messages,
      tools: aiTools,
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
           
           // Immediately broadcast that we are generating an image to show loading skeleton
           broadcastSessionUpdate(sessionId, { 
             chat_history: [
                ...historyRows as ChatHistoryRow[], 
                {
                   id: 'temp-loading',
                   session_id: sessionId,
                   role: 'assistant',
                   content: 'trying to generate an image of your memory..',
                   options: null,
                   created_at: new Date().toISOString()
                }
             ]
           });

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
              db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('GENERATING_IMAGES', sessionId);
            });
            trx();

            // Fire off phase 1 of generation (Images only)
            generateImagesPhase(sessionId).catch(console.error);

            finalReply = "Perfect. The cameras are rolling. Let me synthesize the first visual memories for your approval.";
        }
      }
    }

    if (finalReply && finalReply !== 'trying to generate an image of your memory..') {
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
