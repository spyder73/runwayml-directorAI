import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { splitSubtitleIntoPages } from './subtitle-pagination';

const MIN_SUBTITLE_FONT_SIZE = 22;
const MAX_SUBTITLE_FONT_SIZE = 30;
const MAX_CHARS_PER_LINE = 42;
const MAX_CAPTION_WIDTH_RATIO = 0.84;

export const AnimatedSubtitles: React.FC<{ text: string; durationInFrames: number }> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();

  const fontSize = Math.round(Math.min(MAX_SUBTITLE_FONT_SIZE, Math.max(MIN_SUBTITLE_FONT_SIZE, width * 0.024)));
  const maxCaptionWidth = Math.round(width * MAX_CAPTION_WIDTH_RATIO);
  const maxCharsPerLine = Math.min(
    MAX_CHARS_PER_LINE,
    Math.max(24, Math.floor(maxCaptionWidth / (fontSize * 0.62))),
  );
  const pages = useMemo(() => splitSubtitleIntoPages(text, maxCharsPerLine), [maxCharsPerLine, text]);
  if (!pages.length) return null;

  const pageDuration = Math.max(1, durationInFrames / pages.length);
  const activePageIndex = Math.min(pages.length - 1, Math.max(0, Math.floor(frame / pageDuration)));
  const activePage = pages[activePageIndex];
  const activeWords = activePage.flat();
  const pageStartFrame = activePageIndex * pageDuration;
  const timePerWord = activeWords.length > 0 ? (pageDuration * 0.7) / activeWords.length : 0;
  const lineHeight = 1.16;
  const lineHeightPx = fontSize * lineHeight;
  const lineOffsets = activePage.map((_, index) => (
    activePage.slice(0, index).reduce((total, previousLine) => total + previousLine.length, 0)
  ));

  return (
    <div
      style={{
        position: 'absolute',
        top: '66.666%',
        bottom: 0,
        left: 0,
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        boxSizing: 'border-box',
        padding: `0 ${Math.round(width * 0.08)}px ${Math.max(20, Math.round(height * 0.03))}px`,
        zIndex: 50,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: Math.max(4, Math.round(fontSize * 0.16)),
          minHeight: Math.ceil(lineHeightPx * 2),
          maxWidth: maxCaptionWidth,
          width: '100%',
          textAlign: 'center',
        }}
      >
        {activePage.map((line, lineIndex) => (
          <div
            key={`${activePageIndex}-${lineIndex}`}
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              columnGap: Math.max(6, Math.round(fontSize * 0.22)),
              maxWidth: '100%',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {line.map((word, wordIndex) => {
              const pageWordIndex = lineOffsets[lineIndex] + wordIndex;
              const wordStartTime = pageStartFrame + Math.max(5, pageWordIndex * timePerWord);

              const wordProgress = spring({
                fps,
                frame: frame - wordStartTime,
                config: {
                  damping: 100,
                  stiffness: 200,
                  mass: 0.5,
                },
              });

              const blur = interpolate(wordProgress, [0, 1], [8, 0], {
                extrapolateRight: 'clamp',
              });
              const opacity = interpolate(wordProgress, [0, 1], [0, 1]);
              const translateY = interpolate(wordProgress, [0, 1], [8, 0]);

              return (
                <span
                  key={`${activePageIndex}-${lineIndex}-${wordIndex}`}
                  style={{
                    color: 'white',
                    display: 'inline-block',
                    fontFamily: '"Courier Prime", "Courier New", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
                    fontSize,
                    fontWeight: 700,
                    letterSpacing: 0,
                    lineHeight,
                    opacity,
                    transform: `translateY(${translateY}px) scale(${wordProgress})`,
                    filter: `blur(${blur}px)`,
                    textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 0 3px 12px rgba(0,0,0,0.9)',
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
