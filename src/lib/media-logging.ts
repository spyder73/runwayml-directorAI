import { createHash } from 'crypto';

export type MediaLogLevel = 'info' | 'warn' | 'error';

export type MediaGenerationLogDetails = {
  sessionId?: string;
  taskId?: string;
  kind?: string;
  sceneId?: string | null;
  sceneIndex?: number | null;
  shotIndex?: number;
  shotCount?: number;
  mediaType?: 'image' | 'video' | 'audio';
  provider?: string;
  model?: string;
  duration?: number;
  requestedDuration?: number;
  ratio?: string;
  quality?: string;
  runwayTaskId?: string;
  attempt?: number;
  maxAttempts?: number;
  referenceImageCount?: number;
  promptImageUrl?: string | null;
  localUrl?: string;
  filePath?: string;
  remoteUrl?: string;
  outputCount?: number;
  promptText?: string;
  error?: unknown;
};

function compactPrompt(promptText: string | undefined) {
  if (!promptText) return {};
  const normalized = promptText.replace(/\s+/g, ' ').trim();
  return {
    promptHash: createHash('sha256').update(normalized).digest('hex').slice(0, 12),
    promptLength: normalized.length,
    promptPreview: normalized.slice(0, 220),
  };
}

function safeRemoteUrl(remoteUrl: string | undefined) {
  if (!remoteUrl) return {};
  try {
    const url = new URL(remoteUrl);
    return {
      remoteHost: url.host,
      remotePathExt: url.pathname.split('.').pop()?.slice(0, 8) || undefined,
    };
  } catch {
    return {};
  }
}

function formatError(error: unknown) {
  if (!error) return {};
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }
  return {
    errorMessage: String(error),
  };
}

export function buildMediaGenerationLog(stage: string, details: MediaGenerationLogDetails = {}) {
  const { promptText, error, remoteUrl, ...rest } = details;
  return {
    event: 'media_generation',
    stage,
    timestamp: new Date().toISOString(),
    ...rest,
    ...compactPrompt(promptText),
    ...safeRemoteUrl(remoteUrl),
    ...formatError(error),
  };
}

function suppressLogsForAutomatedTests() {
  if (process.env.MEDIA_GENERATION_LOGS === '1') return false;
  return process.env.NODE_ENV === 'test'
    || process.env.npm_lifecycle_event === 'test'
    || process.argv.includes('--test');
}

export function logMediaGeneration(stage: string, details: MediaGenerationLogDetails = {}, level: MediaLogLevel = 'info') {
  if (suppressLogsForAutomatedTests()) return;
  const entry = buildMediaGenerationLog(stage, details);
  console[level]('[media-generation]', JSON.stringify(entry));
}
