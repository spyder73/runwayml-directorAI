export type VisibleMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string };

export function splitVisibleMessageContent(content: string): VisibleMessagePart[] {
  const parts: VisibleMessagePart[] = [];
  let visionContinuationLines = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes('trying to generate an image of your memory..')) continue;
    if (/^\*?User uploaded/i.test(trimmed)) continue;
    if (/^\*?Vision Analysis:/i.test(trimmed)) {
      visionContinuationLines = 1;
      continue;
    }
    if (visionContinuationLines > 0) {
      visionContinuationLines -= 1;
      continue;
    }

    const imageMatch = trimmed.match(/\[(?:Mockup|Image|Sketch):\s([^\]]+)\]/);
    if (imageMatch) {
      parts.push({ type: 'image', url: imageMatch[1] });
      continue;
    }

    parts.push({ type: 'text', text: trimmed });
  }

  return parts;
}
