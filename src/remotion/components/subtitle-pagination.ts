export type SubtitleLine = string[];
export type SubtitlePage = SubtitleLine[];

export const MAX_SUBTITLE_LINES = 2;

function normalizeSubtitleText(text: string) {
  return text.trim().replace(/\s+/g, ' ');
}

function lineLength(words: string[]) {
  return words.join(' ').length;
}

export function splitSubtitleIntoPages(
  text: string,
  maxCharsPerLine: number,
  maxLines: number = MAX_SUBTITLE_LINES,
): SubtitlePage[] {
  const words = normalizeSubtitleText(text).split(' ').filter(Boolean);
  if (!words.length) return [];

  const safeMaxCharsPerLine = Math.max(12, Math.floor(maxCharsPerLine));
  const safeMaxLines = Math.max(1, Math.floor(maxLines));
  const pages: SubtitlePage[] = [];
  let page: SubtitlePage = [];
  let line: SubtitleLine = [];

  const pushLine = () => {
    if (!line.length) return;
    page.push(line);
    line = [];
  };

  const pushPage = () => {
    pushLine();
    if (!page.length) return;
    pages.push(page);
    page = [];
  };

  for (const word of words) {
    const nextLineLength = line.length ? lineLength(line) + 1 + word.length : word.length;

    if (line.length && nextLineLength > safeMaxCharsPerLine) {
      pushLine();
    }

    if (page.length >= safeMaxLines) {
      pushPage();
    }

    line.push(word);
  }

  pushPage();
  return pages;
}
