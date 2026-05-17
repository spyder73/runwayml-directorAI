import { z } from 'zod';
import { proposeSceneOutlineSchema } from './ai/tools';

type ProposeSceneOutlineInput = z.infer<typeof proposeSceneOutlineSchema>;

export type ProposeSceneOutlineParseResult =
  | {
    success: true;
    data: ProposeSceneOutlineInput;
    normalized: boolean;
    issues: string[];
  }
  | {
    success: false;
    normalized: false;
    issues: string[];
  };

function compactString(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function firstSentence(value: unknown) {
  const text = compactString(value);
  if (!text) return '';

  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return match?.[1]?.trim() || text;
}

function zodIssuePath(issue: z.core.$ZodIssue) {
  return issue.path.length ? issue.path.join('.') : '(root)';
}

function zodIssueStrings(error: z.ZodError) {
  return error.issues.map((issue) => `${zodIssuePath(issue)}: ${issue.message}`);
}

function titleForScene(scene: Record<string, unknown>, index: number) {
  return compactString(scene.title)
    || compactString(scene.sceneTitle)
    || compactString(scene.heading)
    || compactString(scene.name)
    || firstSentence(scene.summary)
    || firstSentence(scene.narratorText)
    || firstSentence(scene.emotionalPurpose)
    || `Scene ${index + 1}`;
}

function summaryForScene(scene: Record<string, unknown>, title: string) {
  return compactString(scene.summary)
    || firstSentence(scene.narratorText)
    || firstSentence(scene.emotionalPurpose)
    || firstSentence(scene.imagePrompt)
    || title;
}

function normalizeSceneOutlineInput(input: unknown) {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { scenes?: unknown }).scenes)) {
    return input;
  }

  const payload = input as Record<string, unknown> & { scenes: unknown[] };
  return {
    ...payload,
    scenes: payload.scenes.map((rawScene, index) => {
      if (!rawScene || typeof rawScene !== 'object') return rawScene;

      const scene = rawScene as Record<string, unknown>;
      const title = titleForScene(scene, index);
      const summary = summaryForScene(scene, title);

      return {
        ...scene,
        title,
        summary,
      };
    }),
  };
}

function findBalancedJsonObject(text: string) {
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return '';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      return text.slice(firstBrace, index + 1);
    }
  }

  return '';
}

function extractJsonObjectText(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return findBalancedJsonObject(trimmed) || trimmed;
}

export function parseProposeSceneOutlineToolInput(input: unknown): ProposeSceneOutlineParseResult {
  const parsed = proposeSceneOutlineSchema.safeParse(input);
  if (parsed.success) {
    return {
      success: true,
      data: parsed.data,
      normalized: false,
      issues: [],
    };
  }

  const initialIssues = zodIssueStrings(parsed.error);
  const normalizedInput = normalizeSceneOutlineInput(input);
  const normalized = proposeSceneOutlineSchema.safeParse(normalizedInput);
  if (normalized.success) {
    return {
      success: true,
      data: normalized.data,
      normalized: true,
      issues: initialIssues,
    };
  }

  return {
    success: false,
    normalized: false,
    issues: zodIssueStrings(normalized.error),
  };
}

export function parseProposeSceneOutlineText(text: string): ProposeSceneOutlineParseResult {
  try {
    return parseProposeSceneOutlineToolInput(JSON.parse(extractJsonObjectText(text)));
  } catch (error) {
    return {
      success: false,
      normalized: false,
      issues: [`json: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
