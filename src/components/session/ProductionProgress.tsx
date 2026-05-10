'use client';

import Image from 'next/image';
import { AlertTriangle, Check, Download, MessageSquare, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import RemotionPreview from '@/components/RemotionPreview';
import { safeProductionPauseMessage } from '@/lib/user-safe-errors';
import type { RenderProgressPayload, SceneRow, SessionRow } from '@/lib/types';

type RetryUnit = 'image' | 'audio' | 'video' | 'render';

type ProductionProgressProps = {
  session: SessionRow;
  scenes: SceneRow[];
  renderProgress?: RenderProgressPayload | null;
  pipelineError: string | null;
  onRetry: (unit?: RetryUnit, sceneId?: string) => void;
  onApproveFrames: () => void;
  onFrameComment: (scene: SceneRow, comment: string) => void;
  onRenderFinal: () => void;
  onOpenImage: (url: string) => void;
};

type SceneShotPlan = {
  duration?: number;
  prompt?: string;
  url?: string;
  reference_image_url?: string;
  status?: string;
};

function parseSceneShotPlan(scene: SceneRow): SceneShotPlan[] {
  if (!scene.shot_plan_json) return [];
  try {
    const parsed = JSON.parse(scene.shot_plan_json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((shot): shot is SceneShotPlan => typeof shot === 'object' && shot !== null);
  } catch {
    return [];
  }
}

function sceneStatusLabel(scene: SceneRow) {
  if (scene.status === 'failed' || scene.status.endsWith('_failed')) return 'Needs another pass';
  if (scene.status === 'completed' || scene.video_url) return 'Complete';
  if (scene.status === 'generating_audio') return 'Recording';
  if (scene.status === 'audio_ready') return 'Narration ready';
  if (scene.status === 'generating_video') return 'Optimizing scene';
  if (scene.status === 'awaiting_approval' || scene.reference_image_url) return 'Frame ready';
  if (scene.status === 'generating_image') return 'Composing frame';
  return 'Queued';
}

function shotStatusLabel(shot: SceneShotPlan) {
  if (shot.url || shot.status === 'succeeded') return 'Complete';
  if (shot.status === 'failed') return 'Needs another pass';
  if (shot.status === 'running') return 'Optimizing scene';
  if (shot.reference_image_url) return 'Optimizing scene';
  return 'Waiting';
}

function retryUnitForScene(scene: SceneRow): { unit: RetryUnit; label: string } | null {
  if (scene.status === 'image_failed' || (scene.status === 'failed' && !scene.reference_image_url)) {
    return { unit: 'image', label: 'Retry frame' };
  }
  if (scene.status === 'audio_failed') {
    return { unit: 'audio', label: 'Retry narration' };
  }
  if (scene.status === 'video_failed') {
    return { unit: 'video', label: 'Retry motion' };
  }
  return null;
}

function clampPercent(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress * 100)));
}

function frameCountLabel(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-';
}

function renderStageLabel(progress: RenderProgressPayload) {
  if (progress.message) return progress.message;
  return progress.stitchStage ? 'Encoding final video' : 'Rendering frames';
}

function SceneSubsceneProgress({ scene, aspectRatio, onOpenImage }: { scene: SceneRow; aspectRatio: SessionRow['aspect_ratio']; onOpenImage: (url: string) => void }) {
  const shotPlan = parseSceneShotPlan(scene);
  if (shotPlan.length < 2 && !shotPlan.some((shot) => shot.reference_image_url || shot.url || shot.status)) return null;

  const completedShots = shotPlan.filter((shot) => shot.url || shot.status === 'succeeded').length;

  return (
    <div className="border-t border-white/10 pt-3">
      <div className="mb-2 flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
        <span>Sub-scenes</span>
        <span>{completedShots}/{shotPlan.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {shotPlan.map((shot, index) => (
          <div key={`${scene.id}-shot-${index}`} className="min-w-0">
            <button
              type="button"
              disabled={!shot.reference_image_url}
              onClick={() => {
                if (shot.reference_image_url) onOpenImage(shot.reference_image_url);
              }}
              className={`relative flex w-full items-center justify-center overflow-hidden border border-white/10 bg-black/40 ${aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'} ${shot.reference_image_url ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {shot.reference_image_url ? (
                <Image src={shot.reference_image_url} alt={`Sub-scene ${index + 1}`} fill unoptimized sizes="160px" className="object-cover" />
              ) : (
                <div className="h-3 w-3 animate-spin rounded-full border-t border-amber-200/50" />
              )}
              <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/65">
                Sub-scene {index + 1}
              </span>
            </button>
            <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">{shotStatusLabel(shot)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProductionProgress({ session, scenes, renderProgress, pipelineError, onRetry, onApproveFrames, onFrameComment, onRenderFinal, onOpenImage }: ProductionProgressProps) {
  const [frameNotes, setFrameNotes] = useState<Record<string, string>>({});
  const isProductionPhase = ['GENERATING_IMAGES', 'AWAITING_APPROVAL', 'GENERATING_FINAL_ASSETS', 'PREVIEW_READY', 'RENDERING', 'COMPLETED'].includes(session.status);
  if (!isProductionPhase && session.status !== 'FAILED') return null;

  const completedScenes = scenes.filter((scene) => scene.status === 'completed' || scene.video_url).length;
  const imagedScenes = scenes.filter((scene) => scene.reference_image_url).length;
  const totalScenes = Math.max(scenes.length, 1);
  const renderPercent = renderProgress ? clampPercent(renderProgress.progress) : 0;

  const copy = (() => {
    if (session.status === 'GENERATING_IMAGES') return { eyebrow: 'First pass', title: 'Composing scene frames', body: 'The first still images are taking shape. Each scene will fill in as its frame is ready.' };
    if (session.status === 'AWAITING_APPROVAL') return { eyebrow: 'Frame review', title: 'Approve the stills', body: 'Look over the scene images. If they feel right, I will turn them into narration and motion next.' };
    if (session.status === 'GENERATING_FINAL_ASSETS') return { eyebrow: 'Second pass', title: 'Filming and narration', body: 'The approved frames are becoming moving scenes with voiceover.' };
    if (session.status === 'FAILED') return { eyebrow: 'Production paused', title: 'One scene needs another pass', body: 'Nothing has been replaced with pretend media. Retry will continue from the missing piece.' };
    if (session.status === 'PREVIEW_READY') return { eyebrow: 'Preview ready', title: "The Director's Cut", body: 'Your generated scenes are ready to watch.' };
    if (session.status === 'RENDERING') return { eyebrow: 'Final pass', title: 'Preparing your film', body: 'The preview is becoming the final downloadable video.' };
    return { eyebrow: 'Complete', title: 'Your film is ready', body: 'The final cut is ready to download.' };
  })();

  return (
    <section className="mt-10 w-full pb-20">
      <div className="mx-auto mb-8 max-w-4xl text-center">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.35em] text-amber-100/45">{copy.eyebrow}</p>
        <h2 className="font-serif text-3xl tracking-widest text-amber-100 md:text-4xl">{copy.title}</h2>
        <p className="mx-auto mt-4 max-w-2xl font-sans text-sm leading-relaxed text-white/55">{copy.body}</p>

        {(session.status === 'GENERATING_IMAGES' || session.status === 'GENERATING_FINAL_ASSETS') && (
          <div className="mx-auto mt-6 max-w-xl">
            <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.25em] text-white/35">
              <span>{session.status === 'GENERATING_IMAGES' ? `${imagedScenes}/${scenes.length || 0} frames ready` : `${completedScenes}/${scenes.length || 0} scenes complete`}</span>
              <span>{session.status === 'GENERATING_IMAGES' ? 'image pass' : 'motion pass'}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-amber-200 transition-all duration-700"
                style={{ width: `${session.status === 'GENERATING_IMAGES' ? (imagedScenes / totalScenes) * 100 : (completedScenes / totalScenes) * 100}%` }}
              />
            </div>
          </div>
        )}

        {session.status === 'AWAITING_APPROVAL' && (
          <button
            type="button"
            onClick={onApproveFrames}
            className="mt-6 inline-flex items-center gap-3 rounded-full bg-white px-7 py-3 font-mono text-xs font-bold uppercase tracking-widest text-black shadow-[0_0_30px_rgba(255,255,255,0.25)] transition-colors hover:bg-amber-100"
          >
            <Check size={17} /> Approve frames
          </button>
        )}
      </div>

      {(session.status === 'FAILED' || pipelineError) && (
        <div className="mx-auto mb-10 max-w-3xl rounded-xl border border-red-400/30 bg-red-950/30 p-5 shadow-[0_0_40px_rgba(248,113,113,0.12)]">
          <div className="flex items-start gap-4">
            <AlertTriangle className="mt-1 text-red-200" size={22} />
            <div className="flex-1">
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-red-100/70">Paused</p>
              <p className="mt-2 font-sans text-sm leading-relaxed text-red-50/80">{safeProductionPauseMessage(pipelineError)}</p>
            </div>
            <button type="button" onClick={() => onRetry()} className="flex items-center gap-2 rounded-full border border-red-200/30 bg-white/10 px-4 py-2 font-mono text-xs uppercase tracking-widest text-red-50 transition-colors hover:bg-red-100 hover:text-black">
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      )}

      {(session.status === 'PREVIEW_READY' || session.status === 'RENDERING' || session.status === 'COMPLETED') ? (
        <div className="flex flex-col items-center gap-8">
          <RemotionPreview scenes={scenes} aspectRatio={session.aspect_ratio} />
          {session.status === 'PREVIEW_READY' && (
            <button type="button" onClick={onRenderFinal} className="flex items-center gap-3 rounded-full bg-white px-8 py-4 font-bold uppercase tracking-widest text-black shadow-[0_0_30px_rgba(255,255,255,0.4)] transition-colors hover:bg-amber-100">
              <Download size={20} /> Prepare Final Film
            </button>
          )}
          {session.status === 'RENDERING' && (
            renderProgress ? (
              <div className="flex w-full max-w-xl flex-col gap-3 font-mono text-sm text-amber-100/75">
                <div className="flex items-center justify-between gap-4 text-[11px] uppercase tracking-[0.22em]">
                  <span>{renderStageLabel(renderProgress)}</span>
                  <span>{renderPercent}%</span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={renderPercent}
                  aria-label="Final render progress"
                >
                  <div
                    className="h-full rounded-full bg-amber-200 shadow-[0_0_18px_rgba(253,230,138,0.35)] transition-all duration-700"
                    style={{ width: `${renderPercent}%` }}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 text-[10px] uppercase tracking-[0.18em] text-white/40 sm:grid-cols-2">
                  <span>Rendered frames {frameCountLabel(renderProgress.renderedFrames)} / {frameCountLabel(renderProgress.totalFrames)}</span>
                  <span>Encoded frames {frameCountLabel(renderProgress.encodedFrames)}</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 font-mono text-sm text-amber-200/70">
                <div className="h-12 w-12 animate-spin rounded-full border-t-2 border-amber-200" />
                Preparing the final cut...
              </div>
            )
          )}
          {session.status === 'COMPLETED' && (
            <a href={session.final_video_url || '#'} download className="flex items-center gap-3 rounded-full border border-green-500/50 bg-green-500/20 px-8 py-4 font-bold uppercase tracking-widest text-green-100 transition-colors hover:bg-green-500/30">
              <Download size={20} /> Download Film
            </a>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {scenes.length > 0 ? scenes.map((scene) => (
            <div key={scene.id} className="flex flex-col gap-4 rounded-lg border border-white/10 bg-white/5 p-4">
              <div className={`relative flex items-center justify-center overflow-hidden border border-white/5 bg-black/50 ${session.aspect_ratio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}>
                <div className="absolute left-3 top-3 z-10 rounded-full border border-white/10 bg-black/55 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/65 backdrop-blur-md">{sceneStatusLabel(scene)}</div>
                {scene.reference_image_url ? (
                  <button type="button" className="relative h-full w-full" onClick={() => onOpenImage(scene.reference_image_url!)}>
                    <Image src={scene.reference_image_url} alt="Scene frame" fill unoptimized sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw" className="object-cover" />
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-t border-amber-200/50" />
                    <p className="font-mono text-[10px] uppercase tracking-widest text-white/30">Drafting scene...</p>
                  </div>
                )}
                {(scene.status === 'failed' || scene.status.endsWith('_failed')) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-950/80 px-4 text-center backdrop-blur-sm">
                    <AlertTriangle size={28} className="text-red-100" />
                    <p className="font-mono text-[10px] uppercase tracking-widest text-red-50/80">Needs another pass</p>
                    {retryUnitForScene(scene) && (
                      <button
                        type="button"
                        onClick={() => {
                          const retry = retryUnitForScene(scene);
                          if (retry) onRetry(retry.unit, scene.id);
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-red-100/30 bg-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-red-50 transition-colors hover:bg-red-100 hover:text-black"
                      >
                        <RefreshCw size={13} /> {retryUnitForScene(scene)?.label}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <p className="line-clamp-3 font-mono text-xs text-white/50">{scene.narrator_text}</p>
              <SceneSubsceneProgress scene={scene} aspectRatio={session.aspect_ratio} onOpenImage={onOpenImage} />
              {session.status === 'AWAITING_APPROVAL' && (
                <div className="flex flex-col gap-2">
                  <input
                    value={frameNotes[scene.id] || ''}
                    onChange={(event) => setFrameNotes((current) => ({ ...current, [scene.id]: event.target.value }))}
                    placeholder="Frame notes..."
                    className="min-w-0 rounded-full border border-white/10 bg-black/30 px-4 py-2.5 font-sans text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-200/40"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const note = frameNotes[scene.id]?.trim();
                      if (!note) return;
                      onFrameComment(scene, note);
                      setFrameNotes((current) => ({ ...current, [scene.id]: '' }));
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <MessageSquare size={13} /> Send frame note
                  </button>
                </div>
              )}
            </div>
          )) : (
            Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="flex animate-pulse flex-col gap-4 rounded-lg border border-white/10 bg-white/5 p-4">
                <div className={`rounded bg-white/5 ${session.aspect_ratio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`} />
                <div className="h-3 w-3/4 rounded bg-white/10" />
                <div className="h-3 w-1/2 rounded bg-white/10" />
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
