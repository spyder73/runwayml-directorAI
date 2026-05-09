import { NextRequest, NextResponse } from 'next/server';
import { generateText, tool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import db from '@/lib/db';
import { broadcastSessionUpdate } from '@/lib/sse';
import { runFinalGenerationPhase } from '@/lib/pipeline_final';
import { z } from 'zod';
import type { SceneRow } from '@/lib/types';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const updateScenePromptSchema = z.object({
  scene_index: z.number().int().nonnegative(),
  new_visual_prompt: z.string().min(1),
});

function getSessionScenes(sessionId: string): SceneRow[] {
  return db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneRow[];
}

function getToolCallInput(call: unknown): unknown {
  if (typeof call !== 'object' || call === null) {
    return {};
  }

  const record = call as Record<string, unknown>;
  return record.args ?? record.input ?? record.parameters ?? {};
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId, message } = await req.json() as { sessionId?: string; message?: string };

    if (!sessionId || !message) {
      return NextResponse.json({ error: 'Missing input' }, { status: 400 });
    }

    const scenes = getSessionScenes(sessionId);
    
    // Vercel AI SDK with Tools for MCP simulation
    const { text, toolCalls } = await generateText({
      model: openrouter('google/gemini-3.1-flash-lite'),
      prompt: `You are a film director. The user wants to adjust the following timeline of scenes.
Current Scenes:
${JSON.stringify(scenes, null, 2)}

User Request: "${message}"

If you need to change a scene, use the \`update_scene_prompt\` tool to change the visual prompt. Then I will regenerate the video.
If it's just a general chat, reply naturally.
`,
      tools: {
        update_scene_prompt: tool({
          description: 'Update the visual prompt for a specific scene index (0-indexed)',
          inputSchema: z.object({
            scene_index: z.number(),
            new_visual_prompt: z.string(),
          }),
        }),
      }
    });

    let responseText = text || "I've made the requested changes. Regenerating now.";
    
    if (toolCalls && toolCalls.length > 0) {
      for (const call of toolCalls) {
        if (call.toolName === 'update_scene_prompt') {
          const args = updateScenePromptSchema.parse(getToolCallInput(call));
          const sceneId = scenes[args.scene_index]?.id;
          if (!sceneId) {
            continue;
          }

          db.prepare('UPDATE scenes SET visual_prompt = ?, status = ?, video_url = NULL WHERE id = ?')
            .run(args.new_visual_prompt, 'generating_video', sceneId);
        }
      }
      
      // Broadcast state update
      broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

      // Triggers regeneration for that scene in background
      runFinalGenerationPhase(sessionId).catch(console.error);

      responseText = `I am adjusting the scenes as requested. Let's see how this new cut looks.`;
    }

    return NextResponse.json({ response: responseText });
  } catch (error: unknown) {
    console.error('Director chat error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
