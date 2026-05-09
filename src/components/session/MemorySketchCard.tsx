'use client';

import Image from 'next/image';
import type { MemoryCandidateRow } from '@/lib/types';

type MemorySketchCardProps = {
  candidates: MemoryCandidateRow[];
  onOpenImage: (url: string) => void;
};

export default function MemorySketchCard({ candidates, onOpenImage }: MemorySketchCardProps) {
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
        </div>
      ))}
    </div>
  );
}
