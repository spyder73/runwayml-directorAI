import React from 'react';
import { AbsoluteFill, Sequence, Video, Audio } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AnimatedSubtitles } from './components/AnimatedSubtitles';

type Scene = {
  id: string;
  video_urls: string[]; // parsed from JSON
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
          {scene.video_urls.map((url, j) => {
            const shotDurationFrames = Math.floor(scene.duration_in_frames / scene.video_urls.length);
            const fromFrame = j * shotDurationFrames;
            const isLast = j === scene.video_urls.length - 1;
            const finalShotDuration = isLast ? scene.duration_in_frames - fromFrame : shotDurationFrames;

            return (
              <Sequence key={`${scene.id}-${j}`} from={fromFrame} durationInFrames={finalShotDuration}>
                <Video src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </Sequence>
            );
          })}

          {scene.audio_url && (
            <Audio src={scene.audio_url} />
          )}
          
          <AnimatedSubtitles text={scene.narrator_text} />
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
