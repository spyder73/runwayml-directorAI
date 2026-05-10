'use client';

import { useState } from 'react';
import { Check, Clapperboard, Loader2, MessageSquare } from 'lucide-react';
import type { StoryTreatmentRow } from '@/lib/types';

type FilmTreatmentCardProps = {
  treatment: StoryTreatmentRow | null;
  isActionable?: boolean;
  isBusy?: boolean;
  isDrafting?: boolean;
  onAccept?: () => void;
  onRequestChanges?: (comment: string) => void;
};

function parseAvoid(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export default function FilmTreatmentCard({
  treatment,
  isActionable = false,
  isBusy = false,
  isDrafting = false,
  onAccept,
  onRequestChanges,
}: FilmTreatmentCardProps) {
  const [changeNote, setChangeNote] = useState('');
  if (!treatment) return null;
  const avoid = parseAvoid(treatment.avoid_json);
  const canSendNote = changeNote.trim().length > 0 && !isBusy;

  return (
    <section className="rounded-lg border border-amber-100/15 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-100/20 bg-amber-100/10 text-amber-100">
          <Clapperboard size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-100/45">Film treatment</p>
          <h2 className="mt-2 font-serif text-2xl tracking-wide text-amber-50">{treatment.title}</h2>
          <p className="mt-3 border-l border-amber-100/25 pl-4 font-serif text-lg italic leading-relaxed text-white/80">{treatment.emotional_thesis}</p>
          <div className="mt-5 grid gap-4 font-sans text-sm leading-relaxed text-white/58 md:grid-cols-2">
            <p><span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">Arc</span><br />{treatment.narrative_arc}</p>
            <p><span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">Motif</span><br />{treatment.visual_motif}</p>
            <p><span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">Voice</span><br />{treatment.narrator_style}</p>
            <p><span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">Ending</span><br />{treatment.ending_feeling}</p>
          </div>
          {avoid.length > 0 && (
            <p className="mt-4 font-sans text-xs leading-relaxed text-white/42">
              <span className="font-mono uppercase tracking-[0.22em]">Keep away from</span> {avoid.join(', ')}
            </p>
          )}
          {isActionable && isDrafting && (
            <div className="mt-6 flex items-center gap-4 border-t border-white/10 pt-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-amber-100/20 bg-amber-100/10 text-amber-100">
                <Loader2 size={19} className="animate-spin" />
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber-100/55">Drafting film shape</p>
                <p className="mt-1 font-sans text-sm leading-relaxed text-white/55">Turning the treatment into scene cards...</p>
              </div>
            </div>
          )}
          {isActionable && !isDrafting && (
            <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
              <div className="flex flex-col gap-3 md:flex-row">
                <button
                  type="button"
                  onClick={onAccept}
                  disabled={isBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 font-mono text-xs font-bold uppercase tracking-widest text-black transition-colors hover:bg-amber-100 disabled:cursor-wait disabled:opacity-50"
                >
                  <Check size={16} /> Draft scenes
                </button>
                <div className="flex min-w-0 flex-1 gap-2">
                  <input
                    value={changeNote}
                    onChange={(event) => setChangeNote(event.target.value)}
                    placeholder="Change the treatment..."
                    disabled={isBusy}
                    className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/30 px-4 py-3 font-sans text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-200/40 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const comment = changeNote.trim();
                      if (!comment) return;
                      onRequestChanges?.(comment);
                      setChangeNote('');
                    }}
                    disabled={!canSendNote}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-3 font-mono text-xs uppercase tracking-widest text-white/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <MessageSquare size={15} /> Revise
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
