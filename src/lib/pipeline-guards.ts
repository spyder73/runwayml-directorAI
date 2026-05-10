import type { SessionMode } from './types';
import { estimateProductionCost } from './cost-estimator';

export type GuardResult = {
  allowed: boolean;
  reasons: string[];
};

type GuardScene = {
  narratorText?: string | null;
  imagePrompt?: string | null;
  videoPrompt?: string | null;
  durationSeconds?: number | null;
  videoUrl?: string | null;
};

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}
function result(reasons: string[]): GuardResult {
  return { allowed: reasons.length === 0, reasons };
}

export function canProposeOutline(params: {
  mode: SessionMode;
  readinessReady: boolean;
  activeReferenceRequest?: boolean;
}) {
  const reasons: string[] = [];
  if (params.mode === 'life_story' && !params.readinessReady) reasons.push('story readiness incomplete');
  if (params.activeReferenceRequest) reasons.push('reference request still open');
  return result(reasons);
}

export function canLockOutline(params: {
  mode: SessionMode;
  userApprovedOutline: boolean;
  treatmentReady: boolean;
  consentChecksPassed: boolean;
  scenes: GuardScene[];
}) {
  const reasons: string[] = [];
  if (!params.treatmentReady) reasons.push('treatment missing');
  if (!params.userApprovedOutline) reasons.push('outline not approved');
  if (!params.consentChecksPassed) reasons.push('consent checks failed');
  if (!params.scenes.length) reasons.push('outline has no scenes');

  params.scenes.forEach((scene, index) => {
    if (!hasText(scene.narratorText)) reasons.push(`scene ${index + 1} missing narration`);
    if (!hasText(scene.imagePrompt)) reasons.push(`scene ${index + 1} missing image prompt`);
    if (!hasText(scene.videoPrompt)) reasons.push(`scene ${index + 1} missing video prompt`);
    if (!Number.isFinite(scene.durationSeconds || 0) || (scene.durationSeconds || 0) < 2) reasons.push(`scene ${index + 1} has invalid duration`);
  });

  const estimate = estimateProductionCost({
    mode: params.mode,
    scenes: params.scenes.map((scene) => ({
      durationSeconds: scene.durationSeconds || 0,
      narratorText: scene.narratorText || '',
    })),
  });
  if (!estimate.withinDemoLimit) {
    reasons.push(`estimated video length ${estimate.totalVideoSeconds}s exceeds ${estimate.demoMaxSeconds}s demo cap`);
  }

  return result(reasons);
}

export function canStartProduction(params: {
  mode: SessionMode;
  treatmentReady: boolean;
  consentChecksPassed: boolean;
  scenes: GuardScene[];
}) {
  return canLockOutline({
    mode: params.mode,
    userApprovedOutline: true,
    treatmentReady: params.treatmentReady,
    consentChecksPassed: params.consentChecksPassed,
    scenes: params.scenes,
  });
}

export function canRenderFinal(params: {
  scenes: GuardScene[];
}) {
  const reasons: string[] = [];
  if (!params.scenes.length) reasons.push('no scenes available');
  params.scenes.forEach((scene, index) => {
    if (!hasText(scene.videoUrl)) reasons.push(`scene ${index + 1} missing video`);
  });
  return result(reasons);
}
