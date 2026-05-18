'use client';

import { useState } from 'react';
import { AlertCircle, Check, Loader2, MessageSquare, Sparkles } from 'lucide-react';
import type { SceneOutlineRow } from '@/lib/types';

export type OutlineRevisionMessage = {
  status: 'loading' | 'updated' | 'clarification' | 'error';
  text: string;
};

type SceneOutlineReviewProps = {
  scenes: SceneOutlineRow[];
  onComment: (scene: SceneOutlineRow, comment: string) => Promise<void> | void;
  onLock: () => void;
  readOnly?: boolean;
  isLocking?: boolean;
  pendingSceneId?: string | null;
  revisionMessages?: Record<string, OutlineRevisionMessage>;
  lockDisabled?: boolean;
  approvalError?: string | null;
};

export default function SceneOutlineReview({
  scenes,
  onComment,
  onLock,
  readOnly = false,
  isLocking = false,
  pendingSceneId = null,
  revisionMessages = {},
  lockDisabled = false,
  approvalError = null,
}: SceneOutlineReviewProps) {
  const [comments, setComments] = useState<Record<string, string>>({});
  const unlocked = scenes.filter((scene) => scene.status !== 'locked');
  const isRevisionPending = Boolean(pendingSceneId);

  if (!unlocked.length) return null;

  return (
    <section className="mt-10 pb-8">
      <div className="mb-6 text-center">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.35em] text-amber-100/45">Outline review</p>
        <h2 className="font-serif text-3xl tracking-widest text-amber-100 md:text-4xl">Your Film Shape</h2>
        <p className="mx-auto mt-4 max-w-2xl font-sans text-sm leading-relaxed text-white/55">
          Read this like a first cut on paper. Add notes to any scene, or approve it when the emotional shape feels true.
        </p>
      </div>

      <div className="space-y-4">
        {unlocked.map((scene) => {
          const comment = comments[scene.id] || '';
          const revisionMessage = revisionMessages[scene.id];
          const isScenePending = pendingSceneId === scene.id || revisionMessage?.status === 'loading';
          const messageIcon = revisionMessage?.status === 'loading'
            ? <Loader2 size={14} className="animate-spin" />
            : revisionMessage?.status === 'error'
              ? <AlertCircle size={14} />
              : <Sparkles size={14} />;

          return (
            <article key={scene.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/35">Scene {scene.scene_index + 1}</p>
                  <h3 className="mt-2 font-serif text-2xl text-white/90">{scene.title}</h3>
                  <p className="mt-2 font-sans text-sm leading-relaxed text-white/60">{scene.summary}</p>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white/45">{scene.duration}s</span>
              </div>
              <p className="mt-4 border-l border-amber-200/30 pl-4 font-serif text-lg italic leading-relaxed text-amber-50/80">{scene.narrator_text}</p>
              {revisionMessage && (
                <div
                  aria-live="polite"
                  className={`mt-4 flex items-start gap-2 rounded-lg border p-3 font-sans text-sm leading-relaxed ${
                    revisionMessage.status === 'error'
                      ? 'border-red-400/25 bg-red-950/25 text-red-50/80'
                      : revisionMessage.status === 'clarification'
                        ? 'border-amber-200/25 bg-amber-200/10 text-amber-50/85'
                        : 'border-white/10 bg-white/[0.05] text-white/70'
                  }`}
                >
                  <span className="mt-0.5 shrink-0 text-amber-100/70">{messageIcon}</span>
                  <span>{revisionMessage.text}</span>
                </div>
              )}
              {!readOnly && (
                <div className="mt-4 flex flex-col gap-3 md:flex-row">
                  <input
                    value={comment}
                    onChange={(event) => setComments((current) => ({ ...current, [scene.id]: event.target.value }))}
                    placeholder="Leave a note for this scene..."
                    disabled={isScenePending}
                    className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/30 px-4 py-3 font-sans text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-200/40 disabled:cursor-wait disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={isScenePending || !comment.trim()}
                    onClick={async () => {
                      const trimmed = comment.trim();
                      if (!trimmed || isScenePending) return;
                      await onComment(scene, trimmed);
                      setComments((current) => ({ ...current, [scene.id]: '' }));
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-5 py-3 font-mono text-xs uppercase tracking-widest text-white/70 transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-40"
                  >
                    {isScenePending ? <Loader2 size={15} className="animate-spin" /> : <MessageSquare size={15} />}
                    {isScenePending ? 'Updating...' : 'Add note'}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {!readOnly && (
        <div className="mt-8 flex flex-col items-center gap-4">
          {approvalError && (
            <div
              aria-live="polite"
              className="w-full max-w-2xl rounded-lg border border-red-400/30 bg-red-950/30 p-4 text-center shadow-[0_0_35px_rgba(248,113,113,0.12)]"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-red-100/70">Could not start production</p>
              <p className="mt-2 font-sans text-sm leading-relaxed text-red-50/80">{approvalError}</p>
            </div>
          )}
          <button
            type="button"
            onClick={onLock}
            disabled={isLocking || isRevisionPending || lockDisabled}
            className="inline-flex items-center gap-3 rounded-full bg-white px-8 py-4 font-mono text-xs font-bold uppercase tracking-widest text-black shadow-[0_0_30px_rgba(255,255,255,0.25)] transition-colors hover:bg-amber-100 disabled:cursor-wait disabled:bg-white/50 disabled:text-black/60"
          >
            {isLocking || isRevisionPending ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            {isLocking ? 'Starting production...' : isRevisionPending ? 'Updating outline...' : 'Approve outline and start production'}
          </button>
        </div>
      )}
    </section>
  );
}
