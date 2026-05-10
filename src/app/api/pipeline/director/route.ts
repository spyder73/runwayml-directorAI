import { NextRequest, NextResponse } from 'next/server';
import { generateText, tool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import db from '@/lib/db';
import { broadcastSessionUpdate } from '@/lib/sse';
import { runFrameGenerationPhase, runMediaGenerationPhase, updateShotPlanPromptJson } from '@/lib/pipeline_media';
import { requeueMediaTasks } from '@/lib/media-tasks';
import { z } from 'zod';
import type { SceneRow, SessionRow } from '@/lib/types';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const updateScenePromptSchema = z.object({
  scene_index: z.number().int().nonnegative(),
  new_visual_prompt: z.string().min(1),
});

const updateSceneShotPromptSchema = z.object({
  scene_index: z.number().int().nonnegative(),
  shot_index: z.number().int().nonnegative(),
  new_video_prompt: z.string().min(1),
  new_reference_prompt: z.string().min(1).optional(),
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
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    const isFrameReview = session?.mode === 'life_story' && session.status === 'AWAITING_APPROVAL';
    
    // Vercel AI SDK with Tools for MCP simulation
    const { text, toolCalls } = await generateText({
      model: openrouter('google/gemini-3.1-flash-lite'),
      prompt: `You are a film director. The user wants to adjust the following timeline of scenes.
Current Scenes:
${JSON.stringify(scenes, null, 2)}

User Request: "${message}"

If you need to change an entire scene, use the \`update_scene_prompt\` tool to change the visual prompt. ${isFrameReview ? 'We are still reviewing generated still frames, so revise the still-frame direction before motion generation.' : 'Then I will regenerate the video.'}
If only one generated sub-scene or shot needs a better prompt, use \`update_scene_shot_prompt\` with the 0-indexed scene_index and shot_index. Preserve the other shots.
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
        update_scene_shot_prompt: tool({
          description: 'Update one generated sub-scene / shot prompt while preserving the other completed shots',
          inputSchema: z.object({
            scene_index: z.number(),
            shot_index: z.number(),
            new_video_prompt: z.string(),
            new_reference_prompt: z.string().optional(),
          }),
        }),
      }
    });

    let responseText = text || "I've made the requested changes. Regenerating now.";
    let forceMotionRetry = false;
    
    if (toolCalls && toolCalls.length > 0) {
      for (const call of toolCalls) {
        if (call.toolName === 'update_scene_prompt') {
          const args = updateScenePromptSchema.parse(getToolCallInput(call));
          const sceneId = scenes[args.scene_index]?.id;
          if (!sceneId) {
            continue;
          }

          if (isFrameReview) {
            db.prepare(`
              UPDATE scenes
              SET visual_prompt = ?,
                  image_prompt = ?,
                  video_prompt = ?,
                  reference_image_url = NULL,
                  video_url = NULL,
                  audio_url = NULL,
                  shot_plan_json = NULL,
                  status = 'pending',
                  last_failure = NULL
              WHERE id = ?
            `).run(args.new_visual_prompt, args.new_visual_prompt, args.new_visual_prompt, sceneId);
            requeueMediaTasks(db, { sessionId, sceneId, kind: 'generate_scene_frame', clearOutput: true });
            requeueMediaTasks(db, { sessionId, sceneId, kind: 'generate_narration', clearOutput: true });
            requeueMediaTasks(db, { sessionId, sceneId, kind: 'generate_video_shot', clearOutput: true });
          } else {
            db.prepare('UPDATE scenes SET visual_prompt = ?, video_prompt = ?, status = ?, video_url = NULL, shot_plan_json = NULL WHERE id = ?')
              .run(args.new_visual_prompt, args.new_visual_prompt, 'video_failed', sceneId);
            requeueMediaTasks(db, {
              sessionId,
              sceneId,
              kind: 'generate_video_shot',
              clearOutput: true,
            });
          }
        } else if (call.toolName === 'update_scene_shot_prompt') {
          const args = updateSceneShotPromptSchema.parse(getToolCallInput(call));
          const scene = scenes[args.scene_index];
          if (!scene) {
            continue;
          }

          const nextShotPlanJson = updateShotPlanPromptJson(scene.shot_plan_json, args.shot_index, {
            prompt: args.new_video_prompt,
            referencePrompt: args.new_reference_prompt,
          });

          db.prepare(`
            UPDATE scenes
            SET shot_plan_json = ?,
                video_url = NULL,
                status = 'video_failed',
                last_failure = NULL
            WHERE id = ?
          `).run(nextShotPlanJson, scene.id);
          requeueMediaTasks(db, {
            sessionId,
            sceneId: scene.id,
            kind: 'generate_video_shot',
            clearOutput: true,
          });
          forceMotionRetry = true;
        }
      }
      
      // Broadcast state update
      broadcastSessionUpdate(sessionId, { scenes: getSessionScenes(sessionId) });

      // Triggers regeneration for that scene in background
      const runner = isFrameReview && !forceMotionRetry ? runFrameGenerationPhase : runMediaGenerationPhase;
      runner(sessionId).catch(console.error);

      responseText = isFrameReview
        ? 'I am adjusting that still frame now. Once it feels right, we can move into motion.'
        : `I am adjusting the scenes as requested. Let's see how this new cut looks.`;
    }

    return NextResponse.json({ response: responseText });
  } catch (error: unknown) {
    console.error('Director chat error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
