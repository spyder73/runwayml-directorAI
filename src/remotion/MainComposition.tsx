import React from 'react';
import { AbsoluteFill, Sequence, Video, Audio } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AnimatedSubtitles } from './components/AnimatedSubtitles';

type Scene = {
  id: string;
  clips: Array<{ url: string; duration_in_frames: number }>;
  audio_url: string;
  narrator_text: string;
  duration_in_frames: number;
};

export const MainComposition = ({ scenes }: { scenes: Scene[] }) => {
  const children: React.ReactNode[] = [];

  scenes.forEach((scene, i) => {
    children.push(
      <TransitionSeries.Sequence
        key={scene.id}
        durationInFrames={scene.duration_in_frames}
      >
        <AbsoluteFill>
          {scene.clips.map((clip, j) => {
            const fromFrame = scene.clips.slice(0, j).reduce((total, item) => total + item.duration_in_frames, 0);
            const isLast = j === scene.clips.length - 1;
            const finalShotDuration = isLast ? scene.duration_in_frames - fromFrame : clip.duration_in_frames;

            return (
              <Sequence key={`${scene.id}-${j}`} from={fromFrame} durationInFrames={finalShotDuration}>
                <Video src={clip.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </Sequence>
            );
          })}

          {scene.audio_url && (
            <Audio src={scene.audio_url} />
          )}
          
          <AnimatedSubtitles text={scene.narrator_text} durationInFrames={scene.duration_in_frames} />
        </AbsoluteFill>
      </TransitionSeries.Sequence>
    );

    if (i < scenes.length - 1) {
      children.push(
        <TransitionSeries.Transition
          key={`transition-${i}`}
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 15 })}
        />
      );
    }
  });

  return (
    <AbsoluteFill className="bg-black">
      <TransitionSeries>
        {children}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
