import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export function createOpenRouterProvider(apiKey: string) {
  return createOpenRouter({ apiKey });
}

export function createOpenRouterModel(apiKey: string, modelId: string) {
  return createOpenRouterProvider(apiKey)(modelId);
}
