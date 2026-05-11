'use client';
import { Player } from '@remotion/player';
import { MainComposition } from '@/remotion/MainComposition';
import { motion } from 'framer-motion';
import { useMemo } from 'react';
import type { AspectRatio, SceneRow } from '@/lib/types';
import { REMOTION_FPS, totalFilmDurationInFrames } from '@/remotion/timing';

type ShotPlanClip = {
  url?: string;
  duration?: number;
};

function parseVideoUrls(videoUrl: string) {
  try {
    const parsed = JSON.parse(videoUrl) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
    }
  } catch {}

  return [videoUrl];
}

function parseShotPlan(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is ShotPlanClip => typeof item === 'object' && item !== null) : [];
  } catch {
    return [];
  }
}

export default function RemotionPreview({ scenes, aspectRatio }: { scenes: SceneRow[]; aspectRatio: AspectRatio }) {
  const { validScenes, totalDurationFrames } = useMemo(() => {
    const parsedScenes = scenes.flatMap((scene) => {
      if (!scene.video_url) return [];

      const parsedUrls = parseVideoUrls(scene.video_url);
      const shotPlan = parseShotPlan(scene.shot_plan_json);
      const videoDuration = shotPlan
        .slice(0, parsedUrls.length)
        .reduce((total, shot) => total + (Number.isFinite(shot.duration) && shot.duration ? shot.duration : 0), 0);
      const narrationDuration = scene.duration || videoDuration || 5;
      const sceneDuration = Math.max(videoDuration || 0, narrationDuration, 1);
      const duration_in_frames = Math.ceil(sceneDuration * REMOTION_FPS);
      const narration_duration_in_frames = Math.max(1, Math.ceil(Math.min(narrationDuration, sceneDuration) * REMOTION_FPS));
      const fallbackClipFrames = Math.max(1, Math.floor(duration_in_frames / Math.max(parsedUrls.length, 1)));
      const clips = parsedUrls.map((url, index) => {
        const shotDuration = shotPlan[index]?.duration;
        return {
          url,
          duration_in_frames: shotDuration ? Math.ceil(shotDuration * REMOTION_FPS) : fallbackClipFrames,
        };
      });

      return [{
        id: scene.id,
        clips,
        audio_url: scene.audio_url ?? '',
        narrator_text: scene.narrator_text,
        duration_in_frames,
        narration_duration_in_frames,
      }];
    });

    return {
      validScenes: parsedScenes,
      totalDurationFrames: totalFilmDurationInFrames(parsedScenes),
    };
  }, [scenes]);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`mx-auto overflow-hidden rounded-xl border border-white/10 shadow-[0_0_50px_rgba(228,255,0,0.1)] ${aspectRatio === '9:16' ? 'w-full max-w-sm' : 'w-full max-w-4xl'}`}
    >
      <div className="bg-black/80 px-4 py-3 border-b border-white/10 flex justify-between items-center">
         <h3 className="font-mono text-xs tracking-widest uppercase text-white/50">Director Cut Preview</h3>
         <div className="flex gap-2">
           <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
         </div>
      </div>
      <div className={`relative bg-black ${aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}>
        {validScenes.length > 0 ? (
          <Player
            component={MainComposition}
            inputProps={{ scenes: validScenes }}
            durationInFrames={totalDurationFrames > 0 ? totalDurationFrames : 1}
            compositionWidth={aspectRatio === '9:16' ? 720 : 1280}
            compositionHeight={aspectRatio === '9:16' ? 1280 : 720}
            fps={REMOTION_FPS}
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
