'use client';

import { useCallback, useEffect, useRef, useState, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { Film, Send, Settings, X } from 'lucide-react';
import AmbientFractalBackground from '@/components/AmbientFractalBackground';
import AvatarDirectorCall from '@/components/session/AvatarDirectorCall';
import InterviewChat from '@/components/session/InterviewChat';
import FilmTreatmentCard from '@/components/session/FilmTreatmentCard';
import MemorySketchCard from '@/components/session/MemorySketchCard';
import ProductionProgress from '@/components/session/ProductionProgress';
import ReferenceUploadRequest from '@/components/session/ReferenceUploadRequest';
import RenderEmailPrompt from '@/components/session/RenderEmailPrompt';
import SceneOutlineReview from '@/components/session/SceneOutlineReview';
import SettingsModal from '@/components/session/SettingsModal';
import { shouldIgnoreStaleProductionUpdate } from '@/lib/session-update-guards';
import type {
  ChatHistoryRow,
  MemoryCandidateRow,
  ReferenceUploadRequestRow,
  RenderProgressPayload,
  SceneOutlineRow,
  SceneRow,
  SessionUpdatePayload,
  SessionRow,
  StoryBucket,
} from '@/lib/types';

function isRenderProgressPayload(value: unknown): value is RenderProgressPayload {
  if (!value || typeof value !== 'object') return false;
  const progress = (value as { progress?: unknown }).progress;
  return typeof progress === 'number' && Number.isFinite(progress);
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.id;
  const searchParams = useSearchParams();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatHistoryRow[]>([]);
  const [storyBucket, setStoryBucket] = useState<StoryBucket | null>(null);
  const [activeReferenceRequest, setActiveReferenceRequest] = useState<ReferenceUploadRequestRow | null>(null);
  const [forceShowVoiceUpload, setForceShowVoiceUpload] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraftingOutline, setIsDraftingOutline] = useState(false);
  const [isSavingRenderEmail, setIsSavingRenderEmail] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState<RenderProgressPayload | null>(null);
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const treatmentReviewRef = useRef<HTMLDivElement>(null);
  const outlineReviewRef = useRef<HTMLDivElement>(null);
  const productionProgressRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<SessionRow | null>(null);
  const scenesRef = useRef<SceneRow[]>([]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);

  const applySessionUpdate = useCallback((data: SessionUpdatePayload) => {
    if (shouldIgnoreStaleProductionUpdate({
      currentSession: sessionRef.current,
      currentScenes: scenesRef.current,
      incomingSession: data.session,
      incomingStatus: data.status,
      incomingScenes: data.scenes,
    })) {
      return;
    }

    const incomingStatus = data.session?.status || data.status;

    if (data.session) {
      sessionRef.current = data.session;
      setSession(data.session);
      setSessionLoadError(null);
    } else if (data.status) {
      setSession((current) => {
        if (!current) return current;
        const next = { ...current, status: data.status! };
        sessionRef.current = next;
        return next;
      });
    }

    if (data.scenes) {
      scenesRef.current = data.scenes;
      setScenes(data.scenes);
    }
    if (data.chat_history) setChatHistory(data.chat_history);
    if (data.story_bucket) setStoryBucket(data.story_bucket);
    if ('active_reference_request' in data) setActiveReferenceRequest(data.active_reference_request || null);
    if ('render_progress' in data) setRenderProgress(isRenderProgressPayload(data.render_progress) ? data.render_progress : null);
    if (data.error) setPipelineError(data.error);
    if (incomingStatus && incomingStatus !== 'FAILED') setPipelineError(null);
    if (incomingStatus && incomingStatus !== 'RENDERING') setRenderProgress(null);
    if (data.chat_chunk) {
      setChatHistory((current) => current.map((row, index) => {
        const isTarget = row.id === data.chat_chunk!.id || (index === current.length - 1 && row.role === 'assistant');
        return isTarget ? { ...row, content: row.content + data.chat_chunk!.text } : row;
      }));
    }
  }, []);

  useEffect(() => {
    const eventSource = new EventSource(`/api/pipeline/events?sessionId=${sessionId}`);

    eventSource.onmessage = (event) => {
      try {
        applySessionUpdate(JSON.parse(event.data) as SessionUpdatePayload);
      } catch (err) {
        console.error('Error parsing session update', err);
      }
    };

    eventSource.onerror = () => {
      setSessionLoadError('Unable to open this session. Sign in again or return to the studio.');
      eventSource.close();
    };

    return () => eventSource.close();
  }, [applySessionUpdate, sessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, storyBucket?.sceneOutline.length]);

  useEffect(() => {
    if (!session) return;
    const voiceMode = searchParams.get('mode') === 'voice' || session.interview_medium === 'voice';
    if (!voiceMode) return;

    const showReference = Boolean(activeReferenceRequest) || (session.status === 'AWAITING_SELFIE' && !session.user_selfie_url);
    const productionActive = [
      'GENERATING_IMAGES',
      'AWAITING_APPROVAL',
      'GENERATING_FINAL_ASSETS',
      'PREVIEW_READY',
      'RENDERING',
      'COMPLETED',
    ].includes(session.status) || scenes.length > 0;
    const unlockedOutline = Boolean(storyBucket?.sceneOutline.some((scene) => scene.status !== 'locked'));
    const treatmentReady = Boolean(storyBucket?.treatment && !unlockedOutline && !productionActive && !showReference);
    const outlineReady = Boolean(unlockedOutline && session.status === 'OUTLINE_REVIEW' && !showReference);
    const target = treatmentReady
      ? treatmentReviewRef.current
      : outlineReady
        ? outlineReviewRef.current
        : productionActive
          ? productionProgressRef.current
          : null;

    if (!target) return;
    const timer = window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [activeReferenceRequest, scenes.length, searchParams, session, storyBucket]);

  const handleSendMessage = async (e?: React.FormEvent, customMsg?: string) => {
    if (e) e.preventDefault();
    if (!customMsg && freeChatDisabled) return;
    const msg = customMsg || message;
    if (!msg.trim()) return;

    setChatHistory((current) => [
      ...current,
      {
        id: `temp-${Date.now()}`,
        session_id: sessionId,
        role: 'user',
        content: msg,
        options: null,
        created_at: new Date().toISOString(),
      },
    ]);
    setMessage('');
    if (showReferenceRequest) {
      setForceShowVoiceUpload(false);
    }
    setIsSending(true);

    try {
      await fetch('/api/pipeline/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: msg }),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);

    const formData = new FormData();
    formData.append('sessionId', sessionId);
    for (let i = 0; i < files.length; i += 1) {
      formData.append('files', files[i]);
    }

    try {
      await fetch('/api/pipeline/upload', { method: 'POST', body: formData });
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploading(false);
      setForceShowVoiceUpload(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleOutlineComment = async (scene: SceneOutlineRow, comment: string) => {
    await fetch('/api/pipeline/outline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, action: 'comment', sceneOutlineId: scene.id, comment }),
    });
    await handleSendMessage(undefined, `For scene ${scene.scene_index + 1}, please revise this: ${comment}`);
  };

  const handleLockOutline = async () => {
    const previousSession = sessionRef.current;
    setPipelineError(null);
    setSession((current) => {
      const next = current ? { ...current, status: 'GENERATING_IMAGES' as const } : current;
      sessionRef.current = next;
      return next;
    });
    try {
      const response = await fetch('/api/pipeline/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'lock' }),
      });
      const data = await response.json() as SessionUpdatePayload & { success?: boolean };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve the outline.');
      }
      applySessionUpdate(data);
    } catch (error) {
      sessionRef.current = previousSession;
      setSession(previousSession);
      setPipelineError(error instanceof Error ? error.message : 'Failed to approve the outline.');
    }
  };

  const handleAcceptTreatment = async () => {
    setIsDraftingOutline(true);
    await handleSendMessage(undefined, 'I approve this film treatment. Please draft the scene outline now.');
  };

  const handleTreatmentRevision = async (comment: string) => {
    await handleSendMessage(undefined, `Please revise the film treatment: ${comment}`);
  };

  const handleRenderFinal = async () => {
    const previousSession = session;
    setPipelineError(null);
    setRenderProgress(null);
    setSession((current) => current ? { ...current, status: 'RENDERING', final_video_url: null } : current);
    try {
      const response = await fetch('/api/pipeline/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        throw new Error('Failed to start final render.');
      }
    } catch (error) {
      setSession(previousSession);
      setPipelineError(error instanceof Error ? error.message : 'Failed to start final render.');
    }
  };

  const handleApproveFrames = async () => {
    await fetch('/api/pipeline/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  };

  const handleFrameComment = async (scene: SceneRow, comment: string) => {
    await fetch('/api/pipeline/director', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: `For scene ${scene.scene_index + 1}, revise the still frame before motion: ${comment}` }),
    });
  };

  const handleSketchFeedback = async (candidate: MemoryCandidateRow, feedback: 'accepted' | 'rejected' | 'revised') => {
    await fetch('/api/pipeline/sketch-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, candidateId: candidate.id, feedback }),
    });
  };

  const handleRetryGeneration = async (unit?: 'image' | 'audio' | 'video' | 'render', sceneId?: string) => {
    setPipelineError(null);
    try {
      await fetch('/api/pipeline/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, unit, sceneId }),
      });
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : 'Failed to restart production.');
    }
  };

  const saveRenderNotificationEmail = async (email: string) => {
    setIsSavingRenderEmail(true);
    try {
      const response = await fetch('/api/pipeline/render-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, email }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save render notification email.');
      }
      setSession((current) => current ? { ...current, render_notification_email: data.render_notification_email } : current);
    } finally {
      setIsSavingRenderEmail(false);
    }
  };

  const resolveActiveReferenceRequest = async (status: 'skipped' | 'described') => {
    if (!session) return;
    if (!activeReferenceRequest && session.status !== 'AWAITING_SELFIE' && session.status !== 'AWAITING_REFERENCE') return;
    setActiveReferenceRequest(null);
    await fetch('/api/pipeline/reference-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, status }),
    });
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.files.length > 0) {
      uploadFiles(event.dataTransfer.files);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0A0A0F] font-mono text-white">
        {sessionLoadError ? (
          <div className="flex max-w-sm flex-col items-center space-y-5 px-6 text-center">
            <p className="text-sm uppercase tracking-widest text-white/60">{sessionLoadError}</p>
            <Link href="/" className="rounded-full border border-white/15 px-5 py-3 text-xs uppercase tracking-widest text-white/70 transition-colors hover:border-white/30 hover:text-white">
              Return to studio
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-4">
            <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-amber-200/50" />
            <p className="animate-pulse text-xs uppercase tracking-widest text-white/50">Entering the Studio...</p>
          </div>
        )}
      </main>
    );
  }

  const isVoiceMode = searchParams.get('mode') === 'voice' || session.interview_medium === 'voice';
  const backendReferenceRequest = Boolean(activeReferenceRequest) || (session.status === 'AWAITING_SELFIE' && !session.user_selfie_url);
  const showReferenceRequest = backendReferenceRequest || (isVoiceMode && forceShowVoiceUpload);
  const isReferenceDescribeDraft = showReferenceRequest && message.trim().length > 0;
  const showComposer = (!isVoiceMode && !showReferenceRequest) || isReferenceDescribeDraft;
  const productionStarted = [
    'GENERATING_IMAGES',
    'AWAITING_APPROVAL',
    'GENERATING_FINAL_ASSETS',
    'PREVIEW_READY',
    'RENDERING',
    'COMPLETED',
  ].includes(session.status) || scenes.length > 0;
  const hasUnlockedOutline = Boolean(storyBucket?.sceneOutline.some((scene) => scene.status !== 'locked'));
  const hasTreatmentAwaitingDecision = Boolean(storyBucket?.treatment && !hasUnlockedOutline && !productionStarted && !showReferenceRequest);
  const hasOutlineAwaitingDecision = Boolean(hasUnlockedOutline && session.status === 'OUTLINE_REVIEW' && !showReferenceRequest);
  const hasSceneOutline = (storyBucket?.sceneOutline.length || 0) > 0;
  const isDraftingFilmShape = isDraftingOutline && !hasSceneOutline && !showReferenceRequest && !pipelineError && !productionStarted;
  const freeChatDisabled = isUploading || isSending || isDraftingFilmShape || hasTreatmentAwaitingDecision || hasOutlineAwaitingDecision;
  const callShouldDock = showReferenceRequest || hasTreatmentAwaitingDecision || hasOutlineAwaitingDecision || productionStarted;
  const shouldEndDirectorCall = [
    'GENERATING_IMAGES',
    'AWAITING_APPROVAL',
    'GENERATING_FINAL_ASSETS',
    'PREVIEW_READY',
    'RENDERING',
    'COMPLETED',
  ].includes(session.status);
  const shouldOfferRenderNotificationEmail = shouldEndDirectorCall && !session.render_notification_email;
  const showRenderEmailPrompt = shouldOfferRenderNotificationEmail;
  const inputPlaceholder = showReferenceRequest
    ? 'Upload, describe, or skip the reference...'
    : isDraftingFilmShape
      ? 'Drafting the film shape...'
      : hasTreatmentAwaitingDecision
      ? 'Approve or revise the treatment above...'
      : hasOutlineAwaitingDecision
        ? 'Use the outline notes or approve it above...'
        : 'Type your response...';

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0A0A0F] font-serif text-white">
      <AmbientFractalBackground intensity="session" />

      {isVoiceMode && (
        <AvatarDirectorCall
          sessionId={sessionId}
          chatHistory={chatHistory}
          docked={callShouldDock}
          showUpload={showReferenceRequest}
          hasReviewPanel={hasTreatmentAwaitingDecision || hasOutlineAwaitingDecision || productionStarted}
          shouldEndForProduction={shouldEndDirectorCall}
          onShowUploadRequested={() => setForceShowVoiceUpload(true)}
        />
      )}

      <header className="pointer-events-none fixed left-0 right-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-[#0A0A0F] to-transparent p-6">
        <div className="flex items-center gap-3 text-white/40">
          <Film size={18} />
          <span className="font-mono text-xs uppercase tracking-[0.3em]">yourlifestory</span>
        </div>
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Open settings"
        >
          <Settings size={18} />
        </button>
      </header>

      <div className={`relative z-[1] flex flex-1 flex-col overflow-y-auto px-4 md:px-20 ${
        isVoiceMode ? (callShouldDock ? 'pt-[23rem]' : 'pt-[calc(100vh+2rem)]') : 'pt-24'
      } ${showReferenceRequest && !isReferenceDescribeDraft ? 'pb-80 md:pb-72' : 'pb-36'}`}>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
          {!isVoiceMode && (
            <InterviewChat
              chatHistory={chatHistory}
              isThinking={isSending || isUploading}
              onOption={(option) => handleSendMessage(undefined, option)}
              onOpenImage={setModalImage}
            />
          )}

          <div ref={treatmentReviewRef} className="scroll-mt-[22rem]" data-avatar-target="treatment-review">
            <FilmTreatmentCard
              treatment={storyBucket?.treatment || null}
              isActionable={isVoiceMode ? false : hasTreatmentAwaitingDecision}
              isBusy={isSending || isDraftingFilmShape}
              isDrafting={isDraftingFilmShape}
              onAccept={handleAcceptTreatment}
              onRequestChanges={handleTreatmentRevision}
            />
          </div>

          <MemorySketchCard
            candidates={storyBucket?.memoryCandidates || []}
            onOpenImage={setModalImage}
            onFeedback={handleSketchFeedback}
          />

          <div ref={outlineReviewRef} className="scroll-mt-[22rem]" data-avatar-target="outline-review">
            <SceneOutlineReview
              scenes={storyBucket?.sceneOutline || []}
              onComment={handleOutlineComment}
              onLock={handleLockOutline}
              readOnly={isVoiceMode}
            />
          </div>

          <div ref={productionProgressRef} className="scroll-mt-[22rem]" data-avatar-target="production-progress">
            <ProductionProgress
              session={session}
              scenes={scenes}
              renderProgress={renderProgress}
              pipelineError={pipelineError}
              onRetry={handleRetryGeneration}
              onApproveFrames={handleApproveFrames}
              onFrameComment={handleFrameComment}
              onRenderFinal={handleRenderFinal}
              onOpenImage={setModalImage}
            />
          </div>

          <div ref={chatEndRef} />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 flex flex-col items-center bg-gradient-to-t from-[#0A0A0F] via-[#0A0A0F] to-transparent p-6" data-avatar-target="reference-upload">
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          ref={fileInputRef}
          onChange={(event) => uploadFiles(event.target.files)}
        />

        {!isReferenceDescribeDraft && (
          <ReferenceUploadRequest
            request={activeReferenceRequest}
            isSelfieRequest={session.status === 'AWAITING_SELFIE' && !session.user_selfie_url}
            hasSelfie={Boolean(session.user_selfie_url)}
            forceVisible={isVoiceMode && forceShowVoiceUpload && !backendReferenceRequest}
            isUploading={isUploading}
            onChooseFiles={() => fileInputRef.current?.click()}
            onSkip={async () => {
              setForceShowVoiceUpload(false);
              await resolveActiveReferenceRequest('skipped');
              await handleSendMessage(undefined, "I'd like to skip that image for now. Please ask me for visual details instead.");
            }}
            onDescribeInstead={async () => {
              const label = activeReferenceRequest?.target_label || 'the reference Nico asked for';
              setMessage(`Here is how ${label} looks: `);
            }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          />
        )}

        {showComposer && (
          <form onSubmit={handleSendMessage} className="group relative w-full max-w-3xl">
            <input
              autoFocus
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={inputPlaceholder}
              className="w-full rounded-full border border-white/10 bg-[#111116]/90 py-4 pl-5 pr-24 font-serif text-lg text-white shadow-2xl outline-none backdrop-blur-xl transition-all placeholder:text-white/30 hover:border-white/20 focus:border-amber-200/50 focus:ring-1 focus:ring-amber-200/20"
              disabled={freeChatDisabled}
            />
            <button
              type="submit"
              disabled={freeChatDisabled || !message.trim()}
              className="absolute inset-y-2 right-2 flex items-center justify-center rounded-full bg-white px-5 text-black transition-all hover:scale-105 hover:bg-amber-200 active:scale-95 disabled:bg-white/20 disabled:text-white disabled:opacity-20"
            >
              <Send size={18} className="ml-0.5" />
            </button>
          </form>
        )}
      </div>

      <RenderEmailPrompt
        session={session}
        visible={showRenderEmailPrompt}
        isSaving={isSavingRenderEmail}
        onSave={saveRenderNotificationEmail}
      />

      <AnimatePresence>
        {modalImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 backdrop-blur-xl"
            onClick={() => setModalImage(null)}
          >
            <button type="button" className="absolute right-6 top-6 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20" onClick={() => setModalImage(null)}>
              <X size={24} />
            </button>
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative aspect-video w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 shadow-[0_0_100px_rgba(255,255,255,0.1)]"
              onClick={(event) => event.stopPropagation()}
            >
              <Image src={modalImage} alt="Fullscreen view" fill className="object-contain" unoptimized />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </main>
  );
}
