'use client';

import { useEffect, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import type { ReferenceUploadRequestRow } from '@/lib/types';

const SELFIE_SAVED_VISIBLE_MS = 3000;

type ReferenceUploadRequestProps = {
  request: ReferenceUploadRequestRow | null;
  isSelfieRequest: boolean;
  hasSelfie: boolean;
  isUploading: boolean;
  onChooseFiles: () => void;
  onSkip: () => void;
  onDescribeInstead: () => void;
  onDrop: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
};

function SelfieSavedBadge() {
  const [showSelfieSaved, setShowSelfieSaved] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSelfieSaved(false), SELFIE_SAVED_VISIBLE_MS);

    return () => window.clearTimeout(timer);
  }, []);

  if (!showSelfieSaved) return null;

  return (
    <div className="mb-4 flex w-full max-w-3xl justify-center">
      <span className="rounded-full border border-emerald-200/15 bg-emerald-500/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-100/60">
        Selfie saved
      </span>
    </div>
  );
}

export default function ReferenceUploadRequest({
  request,
  isSelfieRequest,
  hasSelfie,
  isUploading,
  onChooseFiles,
  onSkip,
  onDescribeInstead,
  onDrop,
  onDragOver,
}: ReferenceUploadRequestProps) {
  if (!request && !isSelfieRequest) {
    if (!hasSelfie) return null;
    return <SelfieSavedBadge />;
  }

  const title = request?.scene_title
    ? `Optional reference for ${request.scene_title}`
    : request?.target_label
      ? `Optional reference for ${request.target_label}`
      : 'Optional protagonist reference';
  const titleText = isSelfieRequest || request?.target_type === 'protagonist'
    ? 'Drop your selfie here'
    : title;
  const body = request?.prompt_text || 'Upload a clear photo only if you want this person or place to appear more faithfully. Skipping is completely fine.';
  const helper = request?.reason || 'This is creative guidance for the film, not a requirement.';

  return (
    <div className="mb-4 flex w-full max-w-3xl flex-col gap-2">
      <button
        type="button"
        className="flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-amber-500/30 bg-[#171111]/95 p-5 text-amber-100/70 shadow-[0_0_30px_rgba(251,191,36,0.05)] transition-colors hover:border-amber-400/50 hover:bg-amber-900/20 hover:text-amber-100 disabled:cursor-wait disabled:opacity-60"
        onClick={onChooseFiles}
        onDrop={onDrop}
        onDragOver={onDragOver}
        disabled={isUploading}
      >
        <UploadCloud size={32} className="text-amber-400/80" />
        <span className="font-serif text-xl text-amber-50">{titleText}</span>
        <span className="max-w-md text-center font-sans text-sm text-amber-100/75">{body}</span>
        <span className="max-w-md text-center font-sans text-xs leading-relaxed text-amber-100/45">{helper}</span>
        <span className="rounded-full border border-white/5 bg-black/40 px-3 py-1 font-mono text-xs uppercase tracking-widest text-white/40">Drop image or choose a photo</span>
      </button>
      <div className="flex justify-center gap-5">
        <button
          type="button"
          onClick={onDescribeInstead}
          className="py-2 font-mono text-xs uppercase tracking-widest text-white/40 transition-colors hover:text-white/80"
        >
          Describe instead
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="py-2 font-mono text-xs uppercase tracking-widest text-white/30 transition-colors hover:text-white/70"
        >
          Skip image
        </button>
      </div>
    </div>
  );
}
