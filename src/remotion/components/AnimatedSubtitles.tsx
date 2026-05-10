import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

export const AnimatedSubtitles: React.FC<{ text: string; durationInFrames: number }> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Split text into words
  const words = useMemo(() => text.split(' ').filter(Boolean), [text]);
  
  // Calculate roughly when each word should appear.
  // We want the text to finish appearing slightly before the end of the clip.
  const timePerWord = words.length > 0 ? (durationInFrames * 0.8) / words.length : 0;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 48,
        left: 0,
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 50,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          columnGap: 8,
          rowGap: 4,
          padding: '16px 32px',
          maxWidth: 960,
          textAlign: 'center',
        }}
      >
        {words.map((word, i) => {
          const wordStartTime = Math.max(10, i * timePerWord); // Start slightly after scene begins
          
          // Animate opacity and scale/y-position using spring
          const wordProgress = spring({
            fps,
            frame: frame - wordStartTime,
            config: {
              damping: 100,
              stiffness: 200,
              mass: 0.5,
            },
          });

          // Optional: slight blur effect as it comes in
          const blur = interpolate(wordProgress, [0, 1], [10, 0], {
            extrapolateRight: 'clamp',
          });
          
          const opacity = interpolate(wordProgress, [0, 1], [0, 1]);
          const translateY = interpolate(wordProgress, [0, 1], [10, 0]);

          return (
            <span
              key={i}
              style={{
                color: 'white',
                fontFamily: 'Georgia, Times New Roman, serif',
                fontSize: 36,
                fontWeight: 700,
                letterSpacing: 0.4,
                lineHeight: 1.18,
                opacity,
                transform: `translateY(${translateY}px) scale(${wordProgress})`,
                filter: `blur(${blur}px)`,
                textShadow: '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0px 4px 15px rgba(0,0,0,0.9)'
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </div>
  );
};
