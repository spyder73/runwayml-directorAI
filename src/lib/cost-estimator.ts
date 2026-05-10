import type { SessionMode } from './types';
import {
  DEMO_VIDEO_LIMITS,
  FINAL_IMAGE_QUALITY,
  RUNWAY_CREDIT_COSTS,
  SKETCH_IMAGE_QUALITY,
} from './production-config';

type SceneCostInput = {
  durationSeconds: number;
  narratorText?: string;
};

export type ProductionCostEstimate = {
  mode: SessionMode;
  sketchCredits: number;
  sceneFrameCredits: number;
  videoCredits: number;
  narrationCredits: number;
  totalCredits: number;
  totalVideoSeconds: number;
  withinDemoLimit: boolean;
  demoMaxSeconds: number;
};

function ttsCredits(text: string) {
  if (!text.trim()) return 0;
  return Math.ceil(text.length / RUNWAY_CREDIT_COSTS.elevenMultilingualV2Chars) * RUNWAY_CREDIT_COSTS.elevenMultilingualV2CreditsPerBlock;
}
export function estimateProductionCost(params: {
  mode: SessionMode;
  scenes: SceneCostInput[];
  sketchCount?: number;
  sketchImageQuality?: keyof typeof RUNWAY_CREDIT_COSTS.gptImage2;
  finalImageQuality?: keyof typeof RUNWAY_CREDIT_COSTS.gptImage2;
}): ProductionCostEstimate {
  const sketchQuality = params.sketchImageQuality || SKETCH_IMAGE_QUALITY;
  const finalQuality = params.finalImageQuality || FINAL_IMAGE_QUALITY;
  const totalVideoSeconds = params.scenes.reduce((total, scene) => total + Math.max(0, Math.ceil(scene.durationSeconds || 0)), 0);
  const sketchCredits = (params.sketchCount || 0) * RUNWAY_CREDIT_COSTS.gptImage2[sketchQuality];
  const sceneFrameCredits = params.scenes.length * RUNWAY_CREDIT_COSTS.gptImage2[finalQuality];
  const videoCredits = totalVideoSeconds * RUNWAY_CREDIT_COSTS.gen4TurboVideoSecond;
  const narrationCredits = params.scenes.reduce((total, scene) => total + ttsCredits(scene.narratorText || ''), 0);
  const demoMaxSeconds = DEMO_VIDEO_LIMITS[params.mode].maxSeconds;

  return {
    mode: params.mode,
    sketchCredits,
    sceneFrameCredits,
    videoCredits,
    narrationCredits,
    totalCredits: sketchCredits + sceneFrameCredits + videoCredits + narrationCredits,
    totalVideoSeconds,
    withinDemoLimit: totalVideoSeconds <= demoMaxSeconds,
    demoMaxSeconds,
  };
}
