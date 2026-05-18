import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { MainComposition, type RemotionScene } from './MainComposition';
import { REMOTION_FPS, totalFilmDurationInFrames } from './timing';

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

type RootProps = {
  scenes: RemotionScene[];
};

const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LifeStoryFilm"
      component={MainComposition}
      defaultProps={{ scenes: [] }}
      fps={REMOTION_FPS}
      width={DEFAULT_WIDTH}
      height={DEFAULT_HEIGHT}
      durationInFrames={1}
      calculateMetadata={({ props }: { props: RootProps }) => {
        return {
          durationInFrames: totalFilmDurationInFrames(props.scenes || []),
        };
      }}
    />
  );
};

registerRoot(RemotionRoot);
