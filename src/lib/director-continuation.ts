import type { SessionStatus } from './types';
import type { StoryBucket } from './types';

type ContinuationMessage = {
  role: string;
  content: string;
};

type ContinuationInput = {
  status: SessionStatus;
  storyContext: string;
  latestUserMessage?: string;
  recentMessages?: ContinuationMessage[];
  recentQuestions?: string[];
  activeReferenceRequestSummary?: string;
  retryReasons?: string[];
};

export function buildDirectorContinuationPrompt(input: ContinuationInput) {
  const recentConversation = formatRecentConversation(input.recentMessages || []);
  const recentQuestions = (input.recentQuestions || []).map((question) => `- ${question.trim()}`).join('\n');
  const retryReasons = (input.retryReasons || []).map((reason) => `- ${reason.trim()}`).join('\n');

  return `You just saved private interview notes. Now write the user-visible response as the Director.

Latest user answer:
${input.latestUserMessage?.trim() || 'No new narrative answer was provided; continue from the latest meaningful story detail.'}

Private story context:
${input.storyContext || 'No private notes yet.'}

Recent conversation:
${recentConversation || 'No recent conversation available.'}

Questions not to repeat:
${recentQuestions || '- None.'}

Reference request state:
${input.activeReferenceRequestSummary || 'No active optional image request.'}

Current phase: ${input.status}.

${retryReasons ? `The previous continuation was rejected because:\n${retryReasons}\n` : ''}
Requirements:
- Return only the visible response.
- Ask exactly one fresh follow-up question.
- Anchor the question in a concrete detail the user already gave, such as a place, profession, book, show, relationship, memory, or life choice.
- Do not repeat or paraphrase any question listed under "Questions not to repeat".
- If the user corrected the interviewer, acknowledge briefly and move forward instead of re-asking the same thing.
- If a protagonist reference/selfie has already been handled, do not ask for another selfie or upload.
- Do not ask vague handoff questions like "What should we explore next?" or "What should we talk about next?"
- Keep the tone warm, cinematic, curious, and specific.
- Do not mention private notes, storage, tools, or implementation details.`;
}

function formatRecentConversation(messages: ContinuationMessage[]) {
  return messages
    .slice(-8)
    .map((message) => `${message.role === 'assistant' ? 'Director' : 'User'}: ${message.content.replace(/\s+/g, ' ').trim()}`)
    .filter((line) => !/:\s*$/.test(line))
    .join('\n');
}

function questionSentences(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const questions: string[] = [];
  const questionPattern = /([^?？.!]*[?？])/g;
  let match: RegExpExecArray | null;
  while ((match = questionPattern.exec(text)) !== null) {
    const question = match[1].trim();
    if (question) questions.push(question);
  }

  return questions;
}

export function extractAssistantQuestions(messages: ContinuationMessage[], limit = 6) {
  const questions: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    questions.push(...questionSentences(message.content));
  }
  return questions.slice(-limit);
}

function normalizeQuestion(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionTokens(value: string) {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'did',
    'do',
    'does',
    'from',
    'in',
    'is',
    'it',
    'of',
    'one',
    'or',
    'that',
    'the',
    'to',
    'what',
    'when',
    'where',
    'which',
    'who',
    'why',
    'with',
    'you',
    'your',
  ]);

  return normalizeQuestion(value)
    .split(' ')
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function questionSimilarity(a: string, b: string) {
  const aTokens = new Set(questionTokens(a));
  const bTokens = new Set(questionTokens(b));
  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.min(aTokens.size, bTokens.size);
}

export function validateDirectorContinuation(input: {
  reply: string | null | undefined;
  recentQuestions?: string[];
  protagonistReferenceHandled?: boolean;
}) {
  const reply = input.reply?.replace(/\s+/g, ' ').trim() || '';
  const reasons: string[] = [];

  if (!reply) {
    reasons.push('The reply was empty.');
    return { valid: false, reasons };
  }

  const questions = questionSentences(reply);
  if (questions.length === 0) {
    reasons.push('The reply did not ask a follow-up question.');
  } else if (questions.length > 1) {
    reasons.push('The reply asked more than one question.');
  }

  const question = questions[0] || reply;
  for (const recentQuestion of input.recentQuestions || []) {
    const normalizedQuestion = normalizeQuestion(question);
    const normalizedRecentQuestion = normalizeQuestion(recentQuestion);
    if (
      normalizedQuestion
      && normalizedRecentQuestion
      && (
        normalizedQuestion === normalizedRecentQuestion
        || questionSimilarity(question, recentQuestion) >= 0.72
      )
    ) {
      reasons.push('The reply repeated or closely paraphrased a recent assistant question.');
      break;
    }
  }

  if (
    input.protagonistReferenceHandled
    && /\b(?:selfie|photo of you|picture of you|upload(?:ing)? (?:a )?(?:photo|image|selfie)|add (?:a )?(?:photo|image|selfie))\b/i.test(reply)
  ) {
    reasons.push('The reply asked for a protagonist image after that reference was already handled.');
  }

  if (/\b(?:private notes|storage|tool calls?|implementation details?)\b/i.test(reply)) {
    reasons.push('The reply mentioned private implementation details.');
  }

  return { valid: reasons.length === 0, reasons };
}

export function safeDirectorOutageContinuation(latestUserMessage?: string) {
  if (/\b(already said|said so|told you|i did|i already)\b/i.test(latestUserMessage || '')) {
    return "You're right, you did. Let's move forward: what changed in you after that moment?";
  }

  return 'Let us stay with the strongest detail you just gave. What changed in you after that moment?';
}

function firstSentence(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)[0] || '';
}

function formatList(items: string[]) {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] || '';
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`;
}

export function buildContextualInterviewFollowUp(
  bucket: StoryBucket,
  options: { latestUserMessage?: string } = {},
) {
  const latestUserMessage = options.latestUserMessage?.trim() || '';
  if (/\b(already said|said so|told you|i did|i already)\b/i.test(latestUserMessage)) {
    return "You're right, you did. Let's move forward: what is another chapter of your life that would help explain who you are now?";
  }

  if (latestUserMessage && !/^\[Image:/i.test(latestUserMessage) && latestUserMessage.length > 18) {
    return 'What is one concrete image, place, or feeling from that part of your life that should appear on screen?';
  }

  const latestMoment = bucket.memoryCandidates.at(-1);
  if (latestMoment) {
    return `In "${latestMoment.title}", what is one image, sound, or feeling that still comes back clearly?`;
  }

  const latestEvent = bucket.timelineEvents.at(-1);
  if (latestEvent) {
    return `You mentioned ${latestEvent.label}. What did that chapter change in you?`;
  }

  const latestEntity = bucket.entities.at(-1);
  if (latestEntity) {
    return `You mentioned ${latestEntity.display_name}. What should the film understand about that connection?`;
  }

  const profile = bucket.profile;
  const profileAnchors = [
    profile?.profession,
    profile?.current_location,
    firstSentence(profile?.summary),
  ].filter((value): value is string => Boolean(value));

  if (profileAnchors.length) {
    return `You mentioned ${formatList(profileAnchors.slice(0, 3))}. What moment made that part of your life feel important enough to belong in the film?`;
  }

  return 'Which earlier or later chapter would help explain who you are now?';
}

export function ensureProactiveDirectorReply(
  reply: string | null | undefined,
  options: { fallbackQuestion: string },
) {
  const trimmedReply = reply?.trim();
  const fallbackQuestion = options.fallbackQuestion.trim();

  if (!trimmedReply) return fallbackQuestion;
  if (/[?？]/.test(trimmedReply)) return trimmedReply;
  if (!fallbackQuestion) return trimmedReply;

  const normalizedReply = /[.!]$/.test(trimmedReply) ? trimmedReply : `${trimmedReply}.`;
  return `${normalizedReply} ${fallbackQuestion}`;
}

export function chooseDirectorVisibleReply(input: {
  streamedText?: string | null;
  text?: string | null;
  directorReply?: string | null;
  chatMessage?: string | null;
  fallbackQuestion: string;
}) {
  const streamedText = (input.streamedText || input.text || '').trim();
  if (streamedText) return streamedText;

  const directorReply = input.directorReply?.trim();
  if (directorReply) {
    return ensureProactiveDirectorReply(directorReply, { fallbackQuestion: input.fallbackQuestion });
  }

  const chatMessage = input.chatMessage?.trim();
  if (!chatMessage) return input.fallbackQuestion.trim();
  if (/[?？]/.test(chatMessage)) return chatMessage;

  const normalizedMessage = /[.!]$/.test(chatMessage) ? chatMessage : `${chatMessage}.`;
  const fallbackQuestion = input.fallbackQuestion.trim();
  return fallbackQuestion ? `${normalizedMessage}\n\n${fallbackQuestion}` : normalizedMessage;
}
