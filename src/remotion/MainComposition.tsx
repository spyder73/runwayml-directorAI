import { AbsoluteFill, Sequence, Video, Audio } from 'remotion';

type Scene = {
  id: string;
  video_url: string;
  audio_url: string;
  narrator_text: string;
};

export const MainComposition = ({ scenes }: { scenes: Scene[] }) => {
  // For this hackathon MVP, we assume each scene is roughly 5 seconds long (150 frames at 30fps)
  const sceneDurationInFrames = 150; 

  return (
    <AbsoluteFill className="bg-black">
      {scenes.map((scene, i) => (
        <Sequence
          key={scene.id}
          from={i * sceneDurationInFrames}
          durationInFrames={sceneDurationInFrames}
        >
          <AbsoluteFill>
            {scene.video_url && (
              <Video src={scene.video_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
            {scene.audio_url && (
              <Audio src={scene.audio_url} />
            )}
            
            {/* Cinematic Subtitles */}
            <div className="absolute bottom-12 w-full flex justify-center">
              <p className="bg-black/60 px-4 py-2 text-white font-mono text-xl text-center max-w-3xl leading-relaxed">
                {scene.narrator_text}
              </p>
            </div>
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
