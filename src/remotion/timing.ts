export const REMOTION_FPS = 30;
export const SCENE_TRANSITION_DURATION_FRAMES = 15;
export const BRANDED_OUTRO_DURATION_FRAMES = REMOTION_FPS * 3;

export type TimedRemotionScene = {
  duration_in_frames: number;
};

export function narrativeContentDurationInFrames(scenes: TimedRemotionScene[]) {
  return scenes.reduce((total, scene) => total + scene.duration_in_frames, 0);
}

export function totalFilmDurationInFrames(scenes: TimedRemotionScene[]) {
  if (!scenes.length) return 1;
  return Math.max(1, narrativeContentDurationInFrames(scenes) + BRANDED_OUTRO_DURATION_FRAMES);
}

export function sceneStartFrames(scenes: TimedRemotionScene[]) {
  let nextStartFrame = 0;

  return scenes.map((scene) => {
    const startFrame = nextStartFrame;
    nextStartFrame += scene.duration_in_frames;
    return startFrame;
  });
}

export function visualDurationForScene(
  scene: TimedRemotionScene,
  index: number,
  totalScenes: number,
) {
  return scene.duration_in_frames + (index < totalScenes - 1 ? SCENE_TRANSITION_DURATION_FRAMES : 0);
}
