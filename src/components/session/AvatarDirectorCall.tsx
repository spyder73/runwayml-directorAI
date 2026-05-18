'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AvatarSession,
  AvatarVideo,
  ControlBar,
  PageActions,
  useAvatarSession,
  useAvatarStatus,
  useClientEvent,
  useTranscript,
} from '@runwayml/avatars-react';
import { useRoomContext } from '@livekit/components-react';
import { PhoneCall, RefreshCw } from 'lucide-react';
import { splitVisibleMessageContent } from '@/lib/chat-display';
import type { ChatHistoryRow } from '@/lib/types';

type AvatarUploadNotice = {
  id: string;
  message: string;
};

type AvatarDirectorCallProps = {
  sessionId: string;
  chatHistory: ChatHistoryRow[];
  docked: boolean;
  showUpload: boolean;
  hasReviewPanel: boolean;
  shouldEndForProduction: boolean;
  voiceUploadNotice: AvatarUploadNotice | null;
  onShowUploadRequested: () => void;
};

type AvatarConnectionCredentials = {
  sessionId: string;
  serverUrl: string;
  token: string;
  roomName: string;
};

type AvatarConnectionState =
  | { status: 'connecting'; credentials: null; error: null }
  | { status: 'ready'; credentials: AvatarConnectionCredentials; error: null }
  | { status: 'error'; credentials: null; error: string };

type LayoutMode = 'stage' | 'docked' | 'upload' | 'review' | 'email';

function layoutFromEvent(value: unknown): LayoutMode | null {
  if (!value || typeof value !== 'object') return null;
  const layout = (value as { layout?: unknown }).layout;
  return layout === 'stage' || layout === 'docked' || layout === 'upload' || layout === 'review' || layout === 'email'
    ? layout
    : null;
}

function formatScriptPreview(content: string) {
  const visibleParts = splitVisibleMessageContent(content);
  const preview = visibleParts
    .map((part) => part.type === 'image' ? 'Image uploaded.' : part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return preview || 'Image uploaded.';
}

type LiveTranscriptEntry = {
  id: string;
  text: string;
};

function ScriptHistorySidebar({ chatHistory }: { chatHistory: ChatHistoryRow[] }) {
  const visibleRows = chatHistory.slice(-20);

  return (
    <aside className="hidden h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-white/10 bg-[#08080b] lg:flex">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/42">Live script</p>
        <div className="h-2 w-2 animate-pulse rounded-full bg-amber-200/80" />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden overscroll-contain p-5 pr-3" data-avatar-transcript-scroll>
        {visibleRows.length === 0 ? (
          <p className="mt-auto min-w-0 border-t border-white/10 pt-4 font-mono text-xs leading-relaxed text-white/38 [overflow-wrap:anywhere]">
            Waiting for the first line.
          </p>
        ) : (
          visibleRows.map((row) => {
            const isUser = row.role === 'user';
            return (
              <article key={row.id} className="min-w-0 border-b border-white/8 pb-3 last:border-b-0">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
                  {isUser ? 'You' : 'Director'}
                </p>
                <p className={`line-clamp-3 min-w-0 font-mono text-xs leading-relaxed [overflow-wrap:anywhere] ${isUser ? 'text-white/76' : 'text-amber-100/72'}`}>
                  {formatScriptPreview(row.content)}
                </p>
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}

function LiveTranscriptSidebar({ chatHistory }: { chatHistory: ChatHistoryRow[] }) {
  const transcript = useTranscript({ interim: true, bufferSize: 40 }) as LiveTranscriptEntry[];
  const liveRows = transcript
    .filter((entry) => entry.text.trim().length > 0)
    .slice(-20);

  if (!liveRows.length) {
    return <ScriptHistorySidebar chatHistory={chatHistory} />;
  }

  return (
    <aside className="hidden h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-white/10 bg-[#08080b] lg:flex">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/42">Live script</p>
        <div className="h-2 w-2 animate-pulse rounded-full bg-amber-200/80" />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden overscroll-contain p-5 pr-3" data-avatar-transcript-scroll>
        {liveRows.map((entry) => (
          <article key={entry.id} className="min-w-0 border-b border-white/8 pb-3 last:border-b-0">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
              Transcript
            </p>
            <p className="line-clamp-3 min-w-0 font-mono text-xs leading-relaxed text-amber-100/72 [overflow-wrap:anywhere]">
              {entry.text}
            </p>
          </article>
        ))}
      </div>
    </aside>
  );
}

function DirectorCallFrame({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden bg-black">
      <div className="absolute inset-y-0 left-0 right-0 min-w-0 overflow-hidden bg-black lg:right-[340px]" data-avatar-video-shell>
        <div className="absolute inset-0 border-[10px] border-black" aria-hidden="true" />
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/72 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-white/54">
            <PhoneCall size={14} className="text-emerald-200/70" />
            Nico Hale
          </div>
          <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.8)]" />
        </div>
        {children}
      </div>
    </div>
  );
}

function DetachedTranscriptPanel({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-auto absolute inset-y-0 right-0 z-20 hidden w-[340px] min-w-0 overflow-hidden border-l border-white/10 bg-[#08080b] lg:block"
      data-avatar-script-panel
    >
      {children}
    </div>
  );
}

function AvatarLoadingGraphic() {
  return (
    <div className="relative mx-auto h-20 w-20" aria-hidden="true">
      <div className="avatar-loader-ring absolute inset-0 rounded-full border border-amber-100/25" />
      <div className="avatar-loader-ring absolute inset-3 rounded-full border border-emerald-100/20" />
      <div className="absolute inset-6 rounded-full bg-amber-100/10 shadow-[0_0_28px_rgba(253,230,138,0.22)]" />
      <div className="avatar-loader-scan absolute left-1/2 top-1/2 h-px w-16 origin-left bg-gradient-to-r from-amber-100/80 to-transparent" />
    </div>
  );
}

function AvatarStageLoadingOverlay() {
  const avatarStatus = useAvatarStatus();
  if (avatarStatus.status === 'ready') return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/72 px-6 text-center backdrop-blur-[2px]">
      <div className="max-w-md pt-10">
        <AvatarLoadingGraphic />
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.24em] text-amber-50/62">
          Syncing video signal
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/58">
          Nico is stepping into frame. The call is live as soon as the studio feed locks.
        </p>
      </div>
    </div>
  );
}

function AvatarConnectionStatus({
  connection,
  onRetry,
}: {
  connection: AvatarConnectionState;
  onRetry: () => void;
}) {
  const isError = connection.status === 'error';

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#10100f] px-6 text-center">
      <div className="max-w-md pt-10">
        {isError ? (
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-white/12 bg-white/[0.04]">
            <RefreshCw size={22} className="text-amber-100/75" />
          </div>
        ) : (
          <AvatarLoadingGraphic />
        )}
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/42">
          {isError ? 'Could not start director call' : 'Preparing Nico'}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/68">
          {isError
            ? connection.error
            : 'Starting the live avatar session. This can take a moment on production while Runway prepares the room.'}
        </p>
        {isError ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex items-center justify-center gap-2 border border-white/14 bg-white/[0.06] px-4 py-3 font-mono text-xs uppercase tracking-[0.16em] text-white/72 transition-colors hover:border-white/28 hover:text-white"
          >
            <RefreshCw size={14} />
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AvatarClientEvents({
  onLayout,
  onShowUploadRequested,
}: {
  onLayout: (layout: LayoutMode) => void;
  onShowUploadRequested: () => void;
}) {
  useClientEvent('set_avatar_layout', (args) => {
    const layout = layoutFromEvent(args);
    if (!layout) return;
    if (layout === 'upload') onShowUploadRequested();
    onLayout(layout);
  });
  useClientEvent('show_upload_dropzone', () => {
    onShowUploadRequested();
    onLayout('upload');
  });
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

function AvatarUploadNoticeBridge({ notice }: { notice: AvatarUploadNotice | null }) {
  const room = useRoomContext();
  const { state } = useAvatarSession();
  const sentNoticeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!notice || state !== 'active' || sentNoticeIdRef.current === notice.id) return;

    sentNoticeIdRef.current = notice.id;
    room.localParticipant.sendText(notice.message, {
      topic: 'lk.chat',
      attributes: { source: 'lifestory-reference-upload' },
    }).catch((error) => {
      console.error('Failed to notify avatar about uploaded reference', error);
    });
  }, [notice, room, state]);

  return null;
}

export default function AvatarDirectorCall({
  sessionId,
  chatHistory,
  docked,
  showUpload,
  hasReviewPanel,
  shouldEndForProduction,
  voiceUploadNotice,
  onShowUploadRequested,
}: AvatarDirectorCallProps) {
  const [clientLayout, setClientLayout] = useState<LayoutMode>('stage');
  const [callEnded, setCallEnded] = useState(false);
  const [callKey, setCallKey] = useState(0);
  const [connection, setConnection] = useState<AvatarConnectionState>({
    status: 'connecting',
    credentials: null,
    error: null,
  });
  const connectionRequestRef = useRef(0);
  const avatarId = process.env.NEXT_PUBLIC_RUNWAY_CHARACTER_AVATAR_ID || 'lifestory-director';

  const computedLayout: LayoutMode = useMemo(() => {
    if (clientLayout === 'upload' && showUpload) return 'upload';
    if (showUpload) return 'upload';
    if (hasReviewPanel && (clientLayout === 'review' || clientLayout === 'email' || clientLayout === 'docked')) return clientLayout;
    if (hasReviewPanel) return 'review';
    return docked ? 'docked' : 'stage';
  }, [clientLayout, docked, hasReviewPanel, showUpload]);

  const isDocked = computedLayout !== 'stage';
  const stageClass = computedLayout === 'upload'
    ? 'top-6 h-[min(42vh,380px)] min-h-[280px] w-[min(94vw,1180px)]'
    : computedLayout === 'review' || computedLayout === 'email' || computedLayout === 'docked'
      ? 'top-4 h-[min(36vh,320px)] min-h-[250px] w-[min(94vw,1180px)]'
      : 'inset-x-4 top-20 bottom-6 mx-auto max-w-[1480px]';

  const startConnection = useCallback(async () => {
    const requestId = connectionRequestRef.current + 1;
    connectionRequestRef.current = requestId;
    setConnection({ status: 'connecting', credentials: null, error: null });

    try {
      const response = await fetch('/api/avatar/session', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appSessionId: sessionId, avatarId }),
      });

      const data = await response.json().catch(() => ({})) as Partial<AvatarConnectionCredentials> & { error?: unknown };
      if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to start director call.');
      }
      if (!data.sessionId || !data.serverUrl || !data.token || !data.roomName) {
        throw new Error('Director call started, but returned incomplete connection credentials.');
      }
      if (connectionRequestRef.current !== requestId) return;
      setConnection({ status: 'ready', credentials: data as AvatarConnectionCredentials, error: null });
    } catch (error) {
      if (connectionRequestRef.current !== requestId) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error('Director call connection error', error);
      setConnection({ status: 'error', credentials: null, error: message });
    }
  }, [avatarId, sessionId]);

  useEffect(() => {
    if (callEnded || shouldEndForProduction) return;
    const timer = window.setTimeout(() => {
      startConnection();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      connectionRequestRef.current += 1;
    };
  }, [callEnded, callKey, shouldEndForProduction, startConnection]);

  const restartCall = () => {
    connectionRequestRef.current += 1;
    setConnection({ status: 'connecting', credentials: null, error: null });
    setCallEnded(false);
    setClientLayout('stage');
    setCallKey((current) => current + 1);
  };

  if (shouldEndForProduction && (callEnded || connection.status !== 'ready')) {
    return null;
  }

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
      className={`director-call fixed z-20 max-h-[calc(100dvh-2rem)] min-h-0 overflow-hidden transition-transform duration-500 ${isDocked ? 'director-call--docked left-1/2 -translate-x-1/2' : ''} ${stageClass}`}
      data-avatar-target="director-call"
      style={{ contain: 'layout paint size' }}
    >
      {connection.status !== 'ready' ? (
        <div className="h-full overflow-hidden rounded border border-black bg-black shadow-[0_26px_90px_rgba(0,0,0,0.72),0_0_0_1px_rgba(255,255,255,0.08)]">
          <DirectorCallFrame>
            <AvatarConnectionStatus connection={connection} onRetry={restartCall} />
          </DirectorCallFrame>
          <DetachedTranscriptPanel>
            <ScriptHistorySidebar chatHistory={chatHistory} />
          </DetachedTranscriptPanel>
        </div>
      ) : (
        <div
          key={`${callKey}-${connection.credentials.sessionId}`}
          data-avatar-call=""
          data-avatar-custom-call=""
          data-avatar-id={avatarId}
          className="h-full min-h-0 overflow-hidden rounded border border-black bg-black shadow-[0_26px_90px_rgba(0,0,0,0.72),0_0_0_1px_rgba(255,255,255,0.08)]"
          style={{ aspectRatio: 'auto' }}
        >
          <AvatarSession
            credentials={connection.credentials}
            video={false}
            onEnd={() => setCallEnded(true)}
            onError={(error) => console.error('Director call error', error)}
          >
            <div className="relative h-full min-h-0 overflow-hidden">
              <DirectorCallFrame>
                <AvatarVideo className="absolute inset-0 h-full w-full bg-black" data-avatar-video-fit="contain" />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0)_45%,rgba(0,0,0,0.74)_100%)]" />
                <AvatarStageLoadingOverlay />
                <div className="absolute bottom-4 right-4 z-10">
                  <ControlBar showCamera={false} showScreenShare={false} className="!static !inset-auto !w-auto !bg-transparent !p-0 rounded-full border border-white/12 backdrop-blur-md" />
                </div>
              </DirectorCallFrame>
              <DetachedTranscriptPanel>
                <LiveTranscriptSidebar chatHistory={chatHistory} />
              </DetachedTranscriptPanel>
            </div>

            <PageActions />
            <AvatarClientEvents onLayout={setClientLayout} onShowUploadRequested={onShowUploadRequested} />
            <AvatarUploadNoticeBridge notice={voiceUploadNotice} />
            <AutoEndOnProduction shouldEnd={shouldEndForProduction} />
          </AvatarSession>
        </div>
      )}
    </section>
  );
}
