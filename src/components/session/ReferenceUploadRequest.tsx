'use client';

import { UploadCloud } from 'lucide-react';
import type { ReferenceUploadRequestRow } from '@/lib/types';

type ReferenceUploadRequestProps = {
  request: ReferenceUploadRequestRow | null;
  isSelfieRequest: boolean;
  isUploading: boolean;
  onChooseFiles: () => void;
  onSkip: () => void;
  onDescribeInstead: () => void;
  onDrop: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
};

export default function ReferenceUploadRequest({
  request,
  isSelfieRequest,
  isUploading,
  onChooseFiles,
  onSkip,
  onDescribeInstead,
  onDrop,
  onDragOver,
}: ReferenceUploadRequestProps) {
  if (!request && !isSelfieRequest) return null;

  const title = request?.target_label
    ? `Add a reference for ${request.target_label}`
    : 'Add your selfie for protagonist scenes';
  const body = request?.reason || 'Only upload this if you want the person or place to appear more faithfully. Skipping is completely fine.';

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
        <span className="font-serif text-xl text-amber-50">{title}</span>
        <span className="max-w-md text-center font-sans text-sm text-amber-100/75">{body}</span>
        <span className="rounded-full border border-white/5 bg-black/40 px-3 py-1 font-mono text-xs uppercase tracking-widest text-white/40">Optional image</span>
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
