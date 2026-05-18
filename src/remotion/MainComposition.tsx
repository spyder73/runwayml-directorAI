import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { Audio, Video } from '@remotion/media';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AnimatedSubtitles } from './components/AnimatedSubtitles';
import {
  BRANDED_OUTRO_DURATION_FRAMES,
  SCENE_TRANSITION_DURATION_FRAMES,
  narrativeContentDurationInFrames,
  sceneStartFrames,
  visualDurationForScene,
} from './timing';

export type RemotionScene = {
  id: string;
  clips: Array<{ url: string; duration_in_frames: number }>;
  audio_url: string;
  audio_playback_rate?: number;
  narrator_text: string;
  duration_in_frames: number;
  narration_duration_in_frames?: number;
};

const Watermark = () => (
  <div
    style={{
      position: 'absolute',
      left: 20,
      bottom: 18,
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 11,
      lineHeight: 1,
      letterSpacing: 0.2,
      color: 'white',
      opacity: 0.2,
      zIndex: 20,
      pointerEvents: 'none',
    }}
  >
    yourlifestory.io
  </div>
);

const BrandedOutro = () => (
  <AbsoluteFill
    style={{
      backgroundColor: 'black',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: 26,
        letterSpacing: 0,
        color: 'rgba(255, 255, 255, 0.84)',
      }}
    >
      Made with yourlifestory.io
    </div>
  </AbsoluteFill>
);

const NarrationTrack = ({ scenes }: { scenes: RemotionScene[] }) => {
  const startFrames = sceneStartFrames(scenes);

  return (
    <>
      {scenes.map((scene, index) => {
        const narrationDuration = Math.max(
          1,
          Math.min(scene.duration_in_frames, scene.narration_duration_in_frames || scene.duration_in_frames),
        );

        return (
          <Sequence key={`${scene.id}-narration`} from={startFrames[index]} durationInFrames={narrationDuration}>
            {scene.audio_url && (
              <Audio src={scene.audio_url} playbackRate={scene.audio_playback_rate || 1} />
            )}
            <AnimatedSubtitles text={scene.narrator_text} durationInFrames={narrationDuration} />
          </Sequence>
        );
      })}
    </>
  );
};

export const MainComposition = ({ scenes }: { scenes: RemotionScene[] }) => {
  const children: React.ReactNode[] = [];
  const contentDuration = narrativeContentDurationInFrames(scenes);

  scenes.forEach((scene, i) => {
    const visualDuration = visualDurationForScene(scene, i, scenes.length);

    children.push(
      <TransitionSeries.Sequence
        key={scene.id}
        durationInFrames={visualDuration}
      >
        <AbsoluteFill>
          {scene.clips.map((clip, j) => {
            const fromFrame = scene.clips.slice(0, j).reduce((total, item) => total + item.duration_in_frames, 0);
            const isLast = j === scene.clips.length - 1;
            const finalShotDuration = isLast ? Math.max(1, visualDuration - fromFrame) : clip.duration_in_frames;

            return (
              <Sequence key={`${scene.id}-${j}`} from={fromFrame} durationInFrames={finalShotDuration}>
                <Video
                  src={clip.url}
                  muted
                  objectFit="cover"
                  style={{ width: '100%', height: '100%' }}
                />
              </Sequence>
            );
          })}
        </AbsoluteFill>
      </TransitionSeries.Sequence>
    );

    if (i < scenes.length - 1) {
      children.push(
        <TransitionSeries.Transition
          key={`transition-${i}`}
          presentation={fade()}
          timing={linearTiming({ durationInFrames: SCENE_TRANSITION_DURATION_FRAMES })}
        />
      );
    }
  });

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <TransitionSeries>
        {children}
      </TransitionSeries>
      <NarrationTrack scenes={scenes} />
      <Sequence from={contentDuration} durationInFrames={BRANDED_OUTRO_DURATION_FRAMES}>
        <BrandedOutro />
      </Sequence>
      <Watermark />
    </AbsoluteFill>
  );
};
