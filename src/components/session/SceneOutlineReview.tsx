'use client';

import { useState } from 'react';
import { Check, MessageSquare } from 'lucide-react';
import type { SceneOutlineRow } from '@/lib/types';

type SceneOutlineReviewProps = {
  scenes: SceneOutlineRow[];
  onComment: (scene: SceneOutlineRow, comment: string) => void;
  onLock: () => void;
};

export default function SceneOutlineReview({ scenes, onComment, onLock }: SceneOutlineReviewProps) {
  const [comments, setComments] = useState<Record<string, string>>({});
  const unlocked = scenes.filter((scene) => scene.status !== 'locked');

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
        {unlocked.map((scene) => (
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
            <div className="mt-4 flex flex-col gap-3 md:flex-row">
              <input
                value={comments[scene.id] || ''}
                onChange={(event) => setComments((current) => ({ ...current, [scene.id]: event.target.value }))}
                placeholder="Leave a note for this scene..."
                className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/30 px-4 py-3 font-sans text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-200/40"
              />
              <button
                type="button"
                onClick={() => {
                  const comment = comments[scene.id]?.trim();
                  if (!comment) return;
                  onComment(scene, comment);
                  setComments((current) => ({ ...current, [scene.id]: '' }));
                }}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-5 py-3 font-mono text-xs uppercase tracking-widest text-white/70 transition-colors hover:bg-white/10"
              >
                <MessageSquare size={15} /> Add note
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-8 flex justify-center">
        <button
          type="button"
          onClick={onLock}
          className="inline-flex items-center gap-3 rounded-full bg-white px-8 py-4 font-mono text-xs font-bold uppercase tracking-widest text-black shadow-[0_0_30px_rgba(255,255,255,0.25)] transition-colors hover:bg-amber-100"
        >
          <Check size={18} /> Approve outline and generate stills
        </button>
      </div>
    </section>
  );
}
