'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AvatarCall,
  AvatarVideo,
  ControlBar,
  PageActions,
  useAvatarSession,
  useClientEvent,
  useTranscript,
} from '@runwayml/avatars-react';
import { PhoneCall, RefreshCw } from 'lucide-react';
import type { ChatHistoryRow } from '@/lib/types';

type AvatarDirectorCallProps = {
  sessionId: string;
  chatHistory: ChatHistoryRow[];
  docked: boolean;
  showUpload: boolean;
  hasReviewPanel: boolean;
  shouldEndForProduction: boolean;
};

type AvatarConnectionCredentials = {
  sessionId: string;
  serverUrl: string;
  token: string;
  roomName: string;
};

type LayoutMode = 'stage' | 'docked' | 'upload' | 'review' | 'email';

function layoutFromEvent(value: unknown): LayoutMode | null {
  if (!value || typeof value !== 'object') return null;
  const layout = (value as { layout?: unknown }).layout;
  return layout === 'stage' || layout === 'docked' || layout === 'upload' || layout === 'review' || layout === 'email'
    ? layout
    : null;
}

function TranscriptOverlay() {
  const transcript = useTranscript({ interim: true, bufferSize: 8 });
  const visibleTranscript = transcript.slice(-4);

  if (!visibleTranscript.length) {
    return (
      <div className="absolute bottom-4 left-4 right-4 rounded border border-white/10 bg-black/55 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white/38 backdrop-blur-md">
        Director audio live
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-4 right-4 max-h-36 overflow-hidden rounded border border-white/10 bg-black/62 px-4 py-3 backdrop-blur-md">
      {visibleTranscript.map((entry) => (
        <p key={entry.id} className="truncate font-mono text-xs text-white/70">
          <span className="text-amber-100/60">{entry.participantIdentity}: </span>
          {entry.text}
        </p>
      ))}
    </div>
  );
}

function ConversationTracker({ chatHistory }: { chatHistory: ChatHistoryRow[] }) {
  const visibleRows = chatHistory.slice(-8);

  return (
    <aside className="hidden h-full min-h-0 flex-col border-l border-white/10 bg-[#08080b] lg:flex">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/42">Live script</p>
        <div className="h-2 w-2 animate-pulse rounded-full bg-amber-200/80" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-5">
        {visibleRows.length === 0 ? (
          <p className="mt-auto border-t border-white/10 pt-4 font-mono text-xs leading-relaxed text-white/38">
            Waiting for the first line.
          </p>
        ) : (
          visibleRows.map((row) => {
            const isUser = row.role === 'user';
            return (
              <article key={row.id} className="border-b border-white/8 pb-3 last:border-b-0">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
                  {isUser ? 'You' : 'Director'}
                </p>
                <p className={`line-clamp-3 font-mono text-xs leading-relaxed ${isUser ? 'text-white/76' : 'text-amber-100/72'}`}>
                  {row.content}
                </p>
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}

function AvatarClientEvents({ onLayout }: { onLayout: (layout: LayoutMode) => void }) {
  useClientEvent('set_avatar_layout', (args) => {
    const layout = layoutFromEvent(args);
    if (layout) onLayout(layout);
  });
  useClientEvent('show_upload_dropzone', () => onLayout('upload'));
  useClientEvent('highlight_review_panel', () => onLayout('review'));
  useClientEvent('focus_email_prompt', () => onLayout('email'));

  return null;
}

function AutoEndOnProduction({ shouldEnd }: { shouldEnd: boolean }) {
  const { end, state } = useAvatarSession();

  useEffect(() => {
    if (!shouldEnd || (state !== 'active' && state !== 'connecting')) return;
    end().catch((error) => console.error('Failed to end avatar call after production handoff', error));
  }, [end, shouldEnd, state]);

  return null;
}

export default function AvatarDirectorCall({
  sessionId,
  chatHistory,
  docked,
  showUpload,
  hasReviewPanel,
  shouldEndForProduction,
}: AvatarDirectorCallProps) {
  const [clientLayout, setClientLayout] = useState<LayoutMode>('stage');
  const [callEnded, setCallEnded] = useState(false);
  const [callKey, setCallKey] = useState(0);
  const connectPromiseRef = useRef<Promise<AvatarConnectionCredentials> | null>(null);

  const computedLayout: LayoutMode = useMemo(() => {
    if (clientLayout !== 'stage') return clientLayout;
    if (showUpload) return 'upload';
    if (hasReviewPanel) return 'review';
    return docked ? 'docked' : 'stage';
  }, [clientLayout, docked, hasReviewPanel, showUpload]);

  const isDocked = computedLayout !== 'stage';
  const stageClass = computedLayout === 'upload'
    ? 'top-6 h-[min(42vh,380px)] min-h-[280px] w-[min(94vw,1180px)]'
    : computedLayout === 'review' || computedLayout === 'email' || computedLayout === 'docked'
      ? 'top-4 h-[min(36vh,320px)] min-h-[250px] w-[min(94vw,1180px)]'
      : 'inset-x-4 top-20 bottom-6 mx-auto max-w-[1480px]';

  const connect = useCallback((avatarId: string) => {
    if (!connectPromiseRef.current) {
      connectPromiseRef.current = fetch('/api/avatar/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appSessionId: sessionId, avatarId }),
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to start director call.');
        }
        return data as AvatarConnectionCredentials;
      }).catch((error) => {
        connectPromiseRef.current = null;
        throw error;
      });
    }

    return connectPromiseRef.current;
  }, [sessionId]);

  const restartCall = () => {
    connectPromiseRef.current = null;
    setCallEnded(false);
    setClientLayout('stage');
    setCallKey((current) => current + 1);
  };

  if (callEnded && !shouldEndForProduction) {
    return (
      <section className="fixed left-1/2 top-24 z-20 w-[min(92vw,720px)] -translate-x-1/2 rounded border border-white/12 bg-black/88 p-4 text-white shadow-[0_20px_80px_rgba(0,0,0,0.55)]">
        <button
          type="button"
          onClick={restartCall}
          className="flex w-full items-center justify-center gap-3 border border-white/14 bg-white/[0.06] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-white/70 transition-colors hover:border-white/28 hover:text-white"
        >
          <RefreshCw size={15} />
          Continue call
        </button>
      </section>
    );
  }

  return (
    <section
      className={`director-call fixed z-20 transition-all duration-500 ${isDocked ? 'director-call--docked left-1/2 -translate-x-1/2' : ''} ${stageClass}`}
      data-avatar-target="director-call"
    >
      <AvatarCall
        key={callKey}
        avatarId={process.env.NEXT_PUBLIC_RUNWAY_CHARACTER_AVATAR_ID || 'lifestory-director'}
        connect={connect}
        video={false}
        onEnd={() => setCallEnded(true)}
        onError={(error) => console.error('Director call error', error)}
        className="h-full overflow-hidden rounded border border-black bg-black shadow-[0_26px_90px_rgba(0,0,0,0.72),0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        <div className="grid h-full min-h-0 grid-cols-1 bg-black lg:grid-cols-[minmax(0,1.58fr)_minmax(300px,0.72fr)]">
          <div className="relative min-h-0 overflow-hidden bg-black">
            <div className="absolute inset-0 border-[10px] border-black" aria-hidden="true" />
            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/72 px-4 py-3 backdrop-blur-md">
              <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-white/54">
                <PhoneCall size={14} className="text-emerald-200/70" />
                Nico Hale
              </div>
              <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.8)]" />
            </div>

            <AvatarVideo className="absolute inset-0 h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0)_45%,rgba(0,0,0,0.74)_100%)]" />
            <TranscriptOverlay />
            <div className="absolute bottom-4 right-4 z-10">
              <ControlBar showCamera={false} showScreenShare={false} className="rounded-full border border-white/12 bg-black/72 px-3 py-2 backdrop-blur-md" />
            </div>
          </div>
          <ConversationTracker chatHistory={chatHistory} />
        </div>

        <PageActions />
        <AvatarClientEvents onLayout={setClientLayout} />
        <AutoEndOnProduction shouldEnd={shouldEndForProduction} />
      </AvatarCall>
    </section>
  );
}
