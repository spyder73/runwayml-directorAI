import type { FinalRenderBackend } from './types';

type FinalRenderBackendEnv = {
  [key: string]: string | undefined;
  FINAL_RENDER_BACKEND?: string;
};

export function isFinalRenderBackend(value: unknown): value is FinalRenderBackend {
  return value === 'local' || value === 'modal';
}

export function normalizeFinalRenderBackend(value: unknown, fallback: FinalRenderBackend = 'local'): FinalRenderBackend {
  return isFinalRenderBackend(value) ? value : fallback;
}

export function isModalRenderingAvailable(env: FinalRenderBackendEnv = process.env) {
  return env.FINAL_RENDER_BACKEND?.trim().toLowerCase() === 'modal';
}

export function resolveFinalRenderBackend(
  env: FinalRenderBackendEnv = process.env,
  preference: FinalRenderBackend = 'modal',
): FinalRenderBackend {
  return isModalRenderingAvailable(env) && preference === 'modal' ? 'modal' : 'local';
}
