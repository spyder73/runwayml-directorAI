import type { SceneRow, SessionRow, SessionStatus } from './types';

const PRODUCTION_STATUSES = new Set<SessionStatus>([
  'GENERATING_IMAGES',
  'AWAITING_APPROVAL',
  'GENERATING_FINAL_ASSETS',
  'PREVIEW_READY',
  'RENDERING',
  'COMPLETED',
  'FAILED',
]);

export function isProductionStatus(status: SessionStatus | null | undefined) {
  return Boolean(status && PRODUCTION_STATUSES.has(status));
}

export function shouldIgnoreStaleProductionUpdate(params: {
  currentSession: Pick<SessionRow, 'status'> | null | undefined;
  currentScenes: Array<Pick<SceneRow, 'id'>>;
  incomingSession?: Pick<SessionRow, 'status'> | null;
  incomingStatus?: SessionStatus | null;
  incomingScenes?: Array<Pick<SceneRow, 'id'>>;
}) {
  const currentIsPastOutline = isProductionStatus(params.currentSession?.status) || params.currentScenes.length > 0;
  if (!currentIsPastOutline) return false;

  const incomingStatus = params.incomingSession?.status || params.incomingStatus;
  if (!incomingStatus) return false;

  return !isProductionStatus(incomingStatus);
}
