import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { MainComposition, type RemotionScene } from './MainComposition';

const FPS = 30;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const BRANDED_OUTRO_DURATION_FRAMES = FPS * 3;

type RootProps = {
  scenes: RemotionScene[];
};

function totalDurationInFrames(scenes: RemotionScene[]) {
  return Math.max(1, scenes.reduce((total, scene) => total + scene.duration_in_frames, 0) + BRANDED_OUTRO_DURATION_FRAMES);
}

const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LifeStoryFilm"
      component={MainComposition}
      defaultProps={{ scenes: [] }}
      fps={FPS}
      width={DEFAULT_WIDTH}
      height={DEFAULT_HEIGHT}
      durationInFrames={1}
      calculateMetadata={({ props }: { props: RootProps }) => {
        return {
          durationInFrames: totalDurationInFrames(props.scenes || []),
        };
      }}
    />
  );
};

registerRoot(RemotionRoot);
