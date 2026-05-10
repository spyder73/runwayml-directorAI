let activeFinalRenderSession: string | null = null;

export function getActiveFinalRenderSession() {
  return activeFinalRenderSession;
}

export function tryAcquireFinalRenderLock(sessionId: string) {
  if (activeFinalRenderSession) {
    return false;
  }

  activeFinalRenderSession = sessionId;
  return true;
}

export function releaseFinalRenderLock(sessionId: string) {
  if (activeFinalRenderSession === sessionId) {
    activeFinalRenderSession = null;
  }
}

export function resetLocksForTests() {
  activeFinalRenderSession = null;
}

export function startFinalRenderWithLock(
  sessionId: string,
  run: () => Promise<unknown> | unknown,
  onError: (error: unknown) => void = console.error,
) {
  if (!tryAcquireFinalRenderLock(sessionId)) {
    return false;
  }

  Promise.resolve()
    .then(run)
    .catch(onError)
    .finally(() => releaseFinalRenderLock(sessionId));

  return true;
}
