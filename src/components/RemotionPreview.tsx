'use client';
import { Player } from '@remotion/player';
import { MainComposition } from '@/remotion/MainComposition';
import { motion } from 'framer-motion';
import { useMemo } from 'react';
import type { SceneRow } from '@/lib/types';

export default function RemotionPreview({ scenes }: { scenes: SceneRow[] }) {
  const fps = 30;

  const { validScenes, totalDurationFrames } = useMemo(() => {
    const parsedScenes = scenes.flatMap((scene) => {
      if (!scene.video_url) return [];

      let parsedUrls: string[] = [];
      try {
        const parsed = JSON.parse(scene.video_url) as unknown;
        parsedUrls = Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === 'string') : [];
      } catch {
        parsedUrls = [scene.video_url];
      }

      const duration_in_frames = Math.ceil((scene.duration || 5) * fps);

      return [{
        id: scene.id,
        video_urls: parsedUrls,
        audio_url: scene.audio_url ?? '',
        narrator_text: scene.narrator_text,
        duration_in_frames,
      }];
    });

    return {
      validScenes: parsedScenes,
      totalDurationFrames: parsedScenes.reduce((total, scene) => total + scene.duration_in_frames, 0),
    };
  }, [scenes]);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-4xl mx-auto rounded-xl overflow-hidden shadow-[0_0_50px_rgba(228,255,0,0.1)] border border-white/10"
    >
      <div className="bg-black/80 px-4 py-3 border-b border-white/10 flex justify-between items-center">
         <h3 className="font-mono text-xs tracking-widest uppercase text-white/50">Director Cut Preview</h3>
         <div className="flex gap-2">
           <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
         </div>
      </div>
      <div className="aspect-video bg-black relative">
        {validScenes.length > 0 ? (
          <Player
            component={MainComposition}
            inputProps={{ scenes: validScenes }}
            durationInFrames={totalDurationFrames > 0 ? totalDurationFrames : 1}
            compositionWidth={1280}
            compositionHeight={720}
            fps={fps}
            controls
            style={{ width: '100%', height: '100%' }}
            autoPlay
          />
        ) : (
          <div className="flex items-center justify-center h-full w-full">
             <p className="text-white/30 font-mono text-sm tracking-widest uppercase">Waiting for video assets...</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
