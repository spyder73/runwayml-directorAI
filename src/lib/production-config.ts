import type { SessionMode } from './types';

export const IMAGE_MODEL = 'gpt_image_2' as const;
export const SKETCH_IMAGE_QUALITY = 'low' as const;
export const FINAL_IMAGE_QUALITY = 'high' as const;
export const VIDEO_MODEL = 'gen4_turbo' as const;
export const NARRATION_MODEL = 'eleven_multilingual_v2' as const;

export const RUNWAY_CREDIT_COSTS = {
  gptImage2: {
    low: 1,
    medium: 5,
    high: 20,
    auto: 20,
  },
  gen4TurboVideoSecond: 5,
  elevenMultilingualV2Chars: 50,
  elevenMultilingualV2CreditsPerBlock: 1,
} as const;

export const DEMO_VIDEO_LIMITS: Record<SessionMode, { minSeconds: number; maxSeconds: number }> = {
  single_memory: { minSeconds: 20, maxSeconds: 40 },
  life_story: { minSeconds: 45, maxSeconds: 75 },
};

export const MAX_REFERENCE_IMAGES_PER_RUNWAY_REQUEST = 16;
export const MIN_RUNWAY_VIDEO_SECONDS = 2;
export const MAX_RUNWAY_VIDEO_SECONDS = 10;
