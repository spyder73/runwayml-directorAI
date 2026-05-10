const DEFAULT_PRODUCTION_PAUSE = 'One scene could not be completed. Retry will continue from the missing piece.';

export function safeProductionPauseMessage(error?: string | null) {
  const message = (error || '').toLowerCase();

  if (!message.trim()) {
    return DEFAULT_PRODUCTION_PAUSE;
  }

  if (message.includes('final render') || message.includes('ffmpeg') || message.includes('generated media file is missing')) {
    return 'The final cut paused while the film was being assembled. The finished scenes are still saved.';
  }

  if (message.includes('image prompt') || message.includes('reference image')) {
    return 'One scene frame needs a cleaner pass before production can continue.';
  }

  if (message.includes('video prompt') || message.includes('motion prompt')) {
    return 'One motion pass needs a cleaner direction before production can continue.';
  }

  if (message.includes('audio') || message.includes('speech') || message.includes('narration')) {
    return 'One narration pass needs another attempt before production can continue.';
  }

  if (message.includes('timeout') || message.includes('rate') || message.includes('runway') || message.includes('unavailable')) {
    return 'The studio paused while waiting for generation. The finished pieces are still saved.';
  }

  return DEFAULT_PRODUCTION_PAUSE;
}
