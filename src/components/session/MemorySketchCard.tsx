'use client';

import Image from 'next/image';
import type { MemoryCandidateRow } from '@/lib/types';

type SketchFeedback = 'accepted' | 'rejected' | 'revised';

type MemorySketchCardProps = {
  candidates: MemoryCandidateRow[];
  onOpenImage: (url: string) => void;
  onFeedback: (candidate: MemoryCandidateRow, feedback: SketchFeedback) => void;
};

function feedbackLabel(candidate: MemoryCandidateRow) {
  if (candidate.status === 'accepted') return 'Direction saved';
  if (candidate.status === 'rejected') return 'We will look for another feeling';
  if (candidate.status === 'revised') return 'Saved with changes';
  return null;
}

export default function MemorySketchCard({ candidates, onOpenImage, onFeedback }: MemorySketchCardProps) {
  const sketched = candidates.filter((candidate) => candidate.sketch_url);
  if (!sketched.length) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sketched.map((candidate) => (
        <div key={candidate.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <button
            type="button"
            onClick={() => candidate.sketch_url && onOpenImage(candidate.sketch_url)}
            className="relative block aspect-video w-full overflow-hidden rounded-md bg-black/40"
          >
            <Image src={candidate.sketch_url || ''} alt={candidate.title} fill className="object-cover" unoptimized />
          </button>
          <div className="mt-4">
            <p className="font-serif text-lg text-white/90">{candidate.title}</p>
            <p className="mt-1 font-sans text-sm leading-relaxed text-white/55">{candidate.description}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onFeedback(candidate, 'accepted')}
              className="rounded-full border border-emerald-200/20 bg-emerald-200/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-emerald-50/75 transition-colors hover:bg-emerald-200/20"
            >
              Keep this direction
            </button>
            <button
              type="button"
              onClick={() => onFeedback(candidate, 'revised')}
              className="rounded-full border border-amber-100/20 bg-amber-100/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-amber-50/75 transition-colors hover:bg-amber-100/20"
            >
              Use it with changes
            </button>
            <button
              type="button"
              onClick={() => onFeedback(candidate, 'rejected')}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-white/50 transition-colors hover:bg-white/10 hover:text-white/75"
            >
              Try a different feeling
            </button>
          </div>
          {feedbackLabel(candidate) && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">{feedbackLabel(candidate)}</p>
          )}
        </div>
      ))}
    </div>
  );
}
