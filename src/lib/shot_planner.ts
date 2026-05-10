import { generateObject, generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export type ShotPlan = {
  duration: number;
  prompt: string;
  referencePrompt?: string;
};

const shotPlanSchema = z.object({
  shots: z.array(z.object({
    duration: z.number().describe('Duration in seconds (2 to 10)'),
    prompt: z.string().describe('Cinematic prompt for this specific shot'),
    reference_prompt: z.string().optional().describe('Still-image prompt for the reference frame at the start of this shot'),
  })),
});

type ProposedShotPlan = ShotPlan & {
  reference_prompt?: string;
};

function compactPromptText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function extractLabeledField(text: string, label: 'prompt' | 'reference_prompt') {
  const labels = ['prompt', 'reference_prompt'];
  const otherLabels = labels.filter((candidate) => candidate !== label).join('|');
  const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${otherLabels})\\s*:|$)`, 'i');
  const match = text.match(pattern);
  return match?.[1] ? compactPromptText(match[1]) : '';
}

export function cleanGeneratorPrompt(value: string | undefined | null) {
  const text = compactPromptText(value || '');
  if (!text) return '';

  const labeledPrompt = extractLabeledField((value || '').trim(), 'prompt');
  if (labeledPrompt) return labeledPrompt;

  return text
    .replace(/^(?:prompt|reference_prompt)\s*:\s*/i, '')
    .trim();
}

export function referencePromptFromGeneratorText(value: string | undefined | null) {
  return extractLabeledField((value || '').trim(), 'reference_prompt');
}

function clampShotDuration(duration: number) {
  return Math.max(2, Math.min(10, Math.round(duration)));
}

function splitDurationIntoShots(durationSeconds: number) {
  const totalDuration = Math.max(2, Math.ceil(durationSeconds));
  const shotCount = Math.max(1, Math.ceil(totalDuration / 10));
  const baseDuration = Math.floor(totalDuration / shotCount);
  let remainder = totalDuration - baseDuration * shotCount;

  return Array.from({ length: shotCount }, () => {
    const duration = baseDuration + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return clampShotDuration(duration);
  });
}

function rebalanceDurations(durations: number[], totalDuration: number) {
  if (!durations.length) return null;
  if (totalDuration < durations.length * 2 || totalDuration > durations.length * 10) return null;

  const balanced = durations.map(clampShotDuration);
  let delta = totalDuration - balanced.reduce((total, duration) => total + duration, 0);

  while (delta !== 0) {
    let adjusted = false;

    for (let index = 0; index < balanced.length && delta !== 0; index += 1) {
      if (delta > 0 && balanced[index] < 10) {
        balanced[index] += 1;
        delta -= 1;
        adjusted = true;
      } else if (delta < 0 && balanced[index] > 2) {
        balanced[index] -= 1;
        delta += 1;
        adjusted = true;
      }
    }

    if (!adjusted) return null;
  }

  return balanced;
}

export function normalizeShotPlan(
  visualPrompt: string,
  durationSeconds: number,
  proposedShots?: ProposedShotPlan[],
): ShotPlan[] {
  const totalDuration = Math.max(2, Math.ceil(durationSeconds));
  const safePrompt = visualPrompt.trim() || 'Cinematic emotional memory scene.';

  if (!proposedShots?.length) {
    const boundedDurations = splitDurationIntoShots(totalDuration);
    return boundedDurations.map((duration, index) => ({
      duration,
      prompt: cleanGeneratorPrompt(index === 0 ? safePrompt : `${safePrompt} Alternate cinematic angle ${index + 1}.`),
      referencePrompt: continuityReferencePrompt({
        visualPrompt: safePrompt,
        shotPrompt: index === 0 ? safePrompt : `${safePrompt} Alternate cinematic angle ${index + 1}.`,
        previousShotPrompts: index === 0 ? [] : [safePrompt],
        index,
      }),
    }));
  }

  const usableShots = proposedShots.filter((shot) => shot.prompt?.trim());
  const boundedDurations = rebalanceDurations(
    usableShots.map((shot) => shot.duration),
    totalDuration,
  ) || splitDurationIntoShots(totalDuration);
  const fallbackPrompt = cleanGeneratorPrompt(usableShots[usableShots.length - 1]?.prompt) || safePrompt;

  return boundedDurations.map((duration, index) => ({
    duration,
    prompt: cleanGeneratorPrompt(usableShots[index]?.prompt) || fallbackPrompt,
    referencePrompt: referencePromptForShot({
      visualPrompt: safePrompt,
      shot: usableShots[index],
      fallbackPrompt,
      previousShotPrompts: usableShots.slice(0, index).map((shot) => cleanGeneratorPrompt(shot.prompt)).filter(Boolean),
      index,
    }),
  }));
}

function referencePromptForShot(params: {
  visualPrompt: string;
  shot: ProposedShotPlan | undefined;
  fallbackPrompt: string;
  previousShotPrompts: string[];
  index: number;
}) {
  const proposed = cleanGeneratorPrompt(params.shot?.referencePrompt || params.shot?.reference_prompt)
    || referencePromptFromGeneratorText(params.shot?.prompt);
  if (proposed) return proposed;

  return continuityReferencePrompt({
    visualPrompt: params.visualPrompt,
    shotPrompt: cleanGeneratorPrompt(params.shot?.prompt) || params.fallbackPrompt,
    previousShotPrompts: params.previousShotPrompts,
    index: params.index,
  });
}

function continuityReferencePrompt(params: {
  visualPrompt: string;
  shotPrompt: string;
  previousShotPrompts: string[];
  index: number;
}) {
  const shotPrompt = cleanGeneratorPrompt(params.shotPrompt) || cleanGeneratorPrompt(params.visualPrompt);
  if (params.index === 0) {
    return shotPrompt;
  }

  return compactPromptText(`Using @opening_frame as the visual reference, ${shotPrompt}`);
}

function parseShotPlanJson(text: string) {
  const candidates = [
    text.trim(),
    ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim()),
  ];
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = shotPlanSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data.shots;
    } catch {}
  }

  return null;
}

function parseShotPlanProse(text: string) {
  const pattern = /(?:^|\n)\s*Shot\s*\d+\s*(?:\((\d+(?:\.\d+)?)\s*(?:seconds?|s)\)|[-:]\s*(\d+(?:\.\d+)?)\s*(?:seconds?|s))\s*:?\s*/gi;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) return null;

  const shots = matches.map((match, index) => {
    const duration = Number(match[1] || match[2]);
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    const prompt = text
      .slice(start, end)
      .trim()
      .split(/\n\s*\n/)[0]
      .replace(/^[-*\s]+/, '')
      .trim();

    return {
      duration,
      prompt: cleanGeneratorPrompt(prompt),
      reference_prompt: referencePromptFromGeneratorText(prompt),
    };
  }).filter((shot) => Number.isFinite(shot.duration) && shot.prompt.length > 0);

  return shots.length ? shots : null;
}

function extractProposedShotsFromText(text: string) {
  return parseShotPlanJson(text) || parseShotPlanProse(text);
}

export function parseShotPlanResponseText(text: string, visualPrompt: string, durationSeconds: number) {
  const proposedShots = extractProposedShotsFromText(text);
  return normalizeShotPlan(visualPrompt, durationSeconds, proposedShots || undefined);
}

function extractAiResponseText(error: unknown) {
  if (typeof error !== 'object' || error === null) return null;
  const direct = (error as { text?: unknown }).text;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null && typeof (cause as { text?: unknown }).text === 'string') {
    return (cause as { text: string }).text;
  }
  return null;
}

async function repairShotPlanTextWithAi(text: string) {
  const { text: repairedText } = await generateText({
    model: openrouter('anthropic/claude-3-haiku'),
    system: 'Convert shot-plan text into strict JSON. Return only JSON matching {"shots":[{"duration":number,"prompt":string,"reference_prompt":string}]}. Do not include markdown, commentary, or field labels inside prompt strings.',
    prompt: text,
  });

  return extractProposedShotsFromText(repairedText);
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
For each shot, provide a slightly adjusted cinematic prompt to reflect the camera angle or action (e.g. "Close up of...", "Wide shot of...").
For each shot, also provide reference_prompt: a still-image prompt for the exact starting frame of that shot.
Every prompt and reference_prompt must be a fully standalone generator instruction. Do not include labels like "prompt:" or "reference_prompt:" inside the strings. Do not mention sub-scenes, previous actions, resets, or orchestration instructions; include only what the image or video generator needs to render.`,
      prompt: `Visual Description: ${visualPrompt}\nTotal Duration: ${durationSeconds.toFixed(1)} seconds. Break this down into shots.`,
      schema: shotPlanSchema,
    });
    
    return normalizeShotPlan(visualPrompt, durationSeconds, object.shots);
  } catch (error) {
    const responseText = extractAiResponseText(error);
    if (responseText) {
      const parsedShots = extractProposedShotsFromText(responseText);
      if (parsedShots?.length) {
        return normalizeShotPlan(visualPrompt, durationSeconds, parsedShots);
      }

      try {
        const repairedShots = await repairShotPlanTextWithAi(responseText);
        if (repairedShots?.length) {
          return normalizeShotPlan(visualPrompt, durationSeconds, repairedShots);
        }
      } catch {}
    }

    console.warn('Shot planner received invalid structured output; using deterministic fallback.');
    return normalizeShotPlan(visualPrompt, durationSeconds);
  }
}
