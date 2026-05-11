'use client';

import { useEffect, useRef, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import type { SessionRow } from '@/lib/types';

type RenderEmailPromptProps = {
  session: SessionRow;
  visible: boolean;
  isSaving: boolean;
  onSave: (email: string) => Promise<void>;
};

export default function RenderEmailPrompt({
  session,
  visible,
  isSaving,
  onSave,
}: RenderEmailPromptProps) {
  const [email, setEmail] = useState(session.render_notification_email || '');
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!visible) return;
    inputRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus('idle');
    try {
      await onSave(email);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="fixed bottom-24 left-1/2 z-30 flex w-[min(92vw,520px)] -translate-x-1/2 items-center gap-3 rounded border border-white/14 bg-black/88 p-3 shadow-[0_18px_70px_rgba(0,0,0,0.62)] backdrop-blur-xl"
      data-avatar-target="render-email"
    >
      <Mail size={18} className="shrink-0 text-amber-100/70" />
      <label className="sr-only" htmlFor="render-notification-email">Where should I send the rendered film?</label>
      <input
        ref={inputRef}
        id="render-notification-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Where should I send the rendered film?"
        className="min-w-0 flex-1 bg-transparent font-mono text-xs uppercase tracking-[0.12em] text-white outline-none placeholder:text-white/36"
      />
      <button
        type="submit"
        disabled={isSaving || !email.trim()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-amber-100 disabled:bg-white/20 disabled:text-white/35"
        aria-label="Save render notification email"
      >
        <Send size={15} />
      </button>
      {status === 'saved' && <span className="sr-only">Saved</span>}
      {status === 'error' && <span className="sr-only">Could not save email</span>}
    </form>
  );
}
