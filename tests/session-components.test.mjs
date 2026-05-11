import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('memory sketch card renders feedback controls for generated sketches', () => {
  const source = fs.readFileSync(new URL('../src/components/session/MemorySketchCard.tsx', import.meta.url), 'utf8');

  assert.match(source, /Keep this direction/);
  assert.match(source, /Try a different feeling/);
  assert.match(source, /Use it with changes/);
});

test('describe instead keeps the active reference request pending until text is submitted', () => {
  const source = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /resolveActiveReferenceRequest\('described'\)/);
});

test('reference upload checkpoint clearly supports selfie drag and drop', () => {
  const source = fs.readFileSync(new URL('../src/components/session/ReferenceUploadRequest.tsx', import.meta.url), 'utf8');

  assert.match(source, /Drop your selfie here/i);
  assert.match(source, /choose a photo/i);
  assert.match(source, /Selfie saved/i);
});

test('selfie saved confirmation dismisses itself after a short delay', () => {
  const source = fs.readFileSync(new URL('../src/components/session/ReferenceUploadRequest.tsx', import.meta.url), 'utf8');

  assert.match(source, /const SELFIE_SAVED_VISIBLE_MS = 3000;/);
  assert.match(source, /function SelfieSavedBadge\(\)/);
  assert.match(source, /const \[showSelfieSaved, setShowSelfieSaved\] = useState\(true\);/);
  assert.match(source, /window\.setTimeout\(\(\) => setShowSelfieSaved\(false\), SELFIE_SAVED_VISIBLE_MS\)/);
  assert.match(source, /window\.clearTimeout\(timer\)/);
  assert.match(source, /if \(!showSelfieSaved\) return null;/);
  assert.match(source, /if \(!hasSelfie\) return null;/);
});

test('reference upload checkpoint hides the composer until describing or resolved', () => {
  const source = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /const isReferenceDescribeDraft = showReferenceRequest && message\.trim\(\)\.length > 0;/);
  assert.match(source, /const showComposer = \(!isVoiceMode && !showReferenceRequest\) \|\| isReferenceDescribeDraft;/);
  assert.doesNotMatch(source, /clearData\(\)/);
  assert.match(source, /\{!isReferenceDescribeDraft && \(\s*<ReferenceUploadRequest/);
  assert.match(source, /\{showComposer && \(\s*<form/);
});

test('chat composer removes general image upload and keeps text clear of the send button', () => {
  const source = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /Camera,/);
  assert.doesNotMatch(source, /<Camera/);
  assert.doesNotMatch(source, /aria-label="Add image"/);
  assert.match(source, /pl-5 pr-24/);
  assert.match(source, /ReferenceUploadRequest/);
});

test('text interview chat shows uploaded images at readable size', () => {
  const source = fs.readFileSync(new URL('../src/components/session/InterviewChat.tsx', import.meta.url), 'utf8');

  assert.match(source, /w-\[min\(72vw,36rem\)\]/);
  assert.match(source, /aspect-\[4\/3\]/);
  assert.match(source, /object-contain/);
  assert.match(source, /Uploaded reference/);
  assert.match(source, /Preview unavailable/);
  assert.match(source, /onError/);
});

test('production progress exposes frame approval before motion generation', () => {
  const source = fs.readFileSync(new URL('../src/components/session/ProductionProgress.tsx', import.meta.url), 'utf8');
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /Approve frames/i);
  assert.match(source, /onApproveFrames/);
  assert.match(source, /Frame notes/i);
  assert.match(pageSource, /\/api\/pipeline\/synthesize/);
});

test('outline approval failures remain visible in the outline review panel', () => {
  const source = fs.readFileSync(new URL('../src/components/session/SceneOutlineReview.tsx', import.meta.url), 'utf8');
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /approvalError\?: string \| null/);
  assert.match(source, /Could not start production/i);
  assert.match(source, /aria-live="polite"/);
  assert.match(pageSource, /const \[outlineApprovalError, setOutlineApprovalError\]/);
  assert.match(pageSource, /approvalError=\{outlineApprovalError\}/);
  assert.match(pageSource, /setOutlineApprovalError\(error instanceof Error \? error\.message : 'Failed to approve the outline\.'\)/);
});

test('production progress exposes one scene-level retry control for failed work', () => {
  const source = fs.readFileSync(new URL('../src/components/session/ProductionProgress.tsx', import.meta.url), 'utf8');

  assert.match(source, /Retry frame/);
  assert.match(source, /Retry narration/);
  assert.match(source, /Repair \+ retry/);
  assert.doesNotMatch(source, /Retry missing piece/);
  assert.doesNotMatch(source, /Nothing has been replaced with pretend media/);
  assert.match(source, /onRetry\(retry\.unit, scene\.id\)/);
});

test('production progress lets failed sessions render when all scene videos are complete', () => {
  const source = fs.readFileSync(new URL('../src/components/session/ProductionProgress.tsx', import.meta.url), 'utf8');

  assert.match(source, /canRenderFromCompletedScenes/);
  assert.match(source, /isRecoverableFailedPreview/);
  assert.match(source, /session\.status === 'PREVIEW_READY' \|\| isRecoverableFailedPreview/);
  assert.match(source, /Prepare Final Film/);
  assert.match(source, /!\s*isRecoverableFailedPreview/);
});

test('production progress exposes sub-scene frames while motion is optimized', () => {
  const source = fs.readFileSync(new URL('../src/components/session/ProductionProgress.tsx', import.meta.url), 'utf8');

  assert.match(source, /parseSceneShotPlan/);
  assert.match(source, /Sub-scene/);
  assert.match(source, /Optimizing scene/);
  assert.match(source, /shot\.reference_image_url/);
});

test('production progress displays final render percentage when available', () => {
  const source = fs.readFileSync(new URL('../src/components/session/ProductionProgress.tsx', import.meta.url), 'utf8');
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /renderProgress\?: RenderProgressPayload \| null/);
  assert.match(source, /renderPercent/);
  assert.match(source, /aria-valuenow/);
  assert.match(source, /Rendered frames/);
  assert.match(source, /Preparing the final cut/);
  assert.match(pageSource, /const \[renderProgress, setRenderProgress\]/);
  assert.match(pageSource, /data\.render_progress/);
  assert.match(pageSource, /renderProgress=\{renderProgress\}/);
});

test('final render action optimistically switches the session into rendering state', () => {
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /setSession\(\(current\) => current \? \{ \.\.\.current, status: 'RENDERING'/);
  assert.match(pageSource, /setRenderProgress\(null\)/);
});

test('treatment review uses explicit actions and disables free chat decisions', () => {
  const cardSource = fs.readFileSync(new URL('../src/components/session/FilmTreatmentCard.tsx', import.meta.url), 'utf8');
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(cardSource, /onAccept/);
  assert.match(cardSource, /onRequestChanges/);
  assert.match(cardSource, /Draft scenes/i);
  assert.match(pageSource, /hasTreatmentAwaitingDecision/);
  assert.match(pageSource, /freeChatDisabled/);
  assert.match(pageSource, /I approve this film treatment/);
});

test('approving a treatment shows drafting animation until the film shape appears', () => {
  const cardSource = fs.readFileSync(new URL('../src/components/session/FilmTreatmentCard.tsx', import.meta.url), 'utf8');
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(cardSource, /isDrafting/);
  assert.match(cardSource, /Drafting film shape/i);
  assert.match(cardSource, /animate-spin/);
  assert.match(pageSource, /isDraftingOutline/);
  assert.match(pageSource, /isDraftingFilmShape/);
  assert.match(pageSource, /setIsDraftingOutline\(true\)/);
  assert.match(pageSource, /!hasSceneOutline/);
});

test('director route can revise a single generated sub-scene prompt', () => {
  const source = fs.readFileSync(new URL('../src/app/api/pipeline/director/route.ts', import.meta.url), 'utf8');

  assert.match(source, /update_scene_shot_prompt/);
  assert.match(source, /shot_index/);
  assert.match(source, /updateShotPlanPromptJson/);
});

test('home page exposes only the LifeStory start entrypoint', () => {
  const source = fs.readFileSync(new URL('../src/components/home/StudioHome.tsx', import.meta.url), 'utf8');

  assert.match(source, /Describe Your Life Story/);
  assert.match(source, /Nico Hale/);
  assert.match(source, /Hey, I'm Nico Hale, your content director/);
  assert.match(source, /AI content director/);
  assert.match(source, /\/landing\/director-studio/);
  assert.doesNotMatch(source, /Begin the interview/i);
  assert.doesNotMatch(source, /handleStart\('single_memory'\)/);
  assert.doesNotMatch(source, /Generate a Video of a Memory/);
  assert.doesNotMatch(source, /\/api\/pipeline\/demo/);
  assert.doesNotMatch(source, /Open rehearsal memory/);
});

test('home page action panel stays to the right of the director image on desktop', () => {
  const source = fs.readFileSync(new URL('../src/components/home/StudioHome.tsx', import.meta.url), 'utf8');

  assert.match(source, /lg:ml-\[44vw\]/);
  assert.match(source, /lg:w-\[min\(52vw,760px\)\]/);
  assert.doesNotMatch(source, /lg:ml-\[30vw\]/);
});

test('frontend brand copy uses yourlifestory in visible surfaces', () => {
  const sources = [
    '../src/components/home/LandingPage.tsx',
    '../src/components/home/StudioHome.tsx',
    '../src/app/session/[id]/page.tsx',
    '../src/app/login/page.tsx',
    '../src/app/register/page.tsx',
    '../src/app/verify-email/page.tsx',
    '../src/app/layout.tsx',
  ].map((filePath) => fs.readFileSync(new URL(filePath, import.meta.url), 'utf8')).join('\n');

  assert.match(sources, /yourlifestory/);
  assert.doesNotMatch(sources, /let Lifestory/);
  assert.doesNotMatch(sources, />Lifestory</);
  assert.doesNotMatch(sources, /title:\s*"Lifestory\.ai"/);
});

test('home page lets users choose voice or text interview medium', () => {
  const source = fs.readFileSync(new URL('../src/components/home/StudioHome.tsx', import.meta.url), 'utf8');

  assert.match(source, /Call the Director/);
  assert.match(source, /Communicate via text/);
  assert.match(source, /interviewMedium: 'voice'/);
  assert.match(source, /interviewMedium: 'text'/);
  assert.match(source, /mode=voice/);
});

test('voice session renders Runway avatar stage without webcam and docks around workflow panels', () => {
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /useSearchParams/);
  assert.match(pageSource, /isVoiceMode/);
  assert.match(pageSource, /AvatarDirectorCall/);
  assert.match(callSource, /AvatarSession/);
  assert.doesNotMatch(callSource, /<AvatarCall/);
  assert.match(callSource, /video=\{false\}/);
  assert.match(callSource, /PageActions/);
  assert.match(callSource, /useTranscript/);
  assert.match(callSource, /connectionRequestRef/);
  assert.match(callSource, /set_avatar_layout/);
  assert.match(callSource, /LiveTranscriptSidebar/);
  assert.match(callSource, /director-call--docked/);
  assert.match(callSource, /splitVisibleMessageContent/);
  assert.match(callSource, /formatScriptPreview/);
  assert.match(callSource, /Image uploaded\./);
  assert.doesNotMatch(callSource, /TranscriptOverlay/);
  assert.doesNotMatch(callSource, /participantIdentity/);
  assert.doesNotMatch(callSource, /\{row\.content\}/);
  assert.match(callSource, /!static/);
  assert.match(callSource, /!bg-transparent/);
  assert.match(callSource, /!p-0/);
});

test('voice upload client event can reveal the upload panel before the backend request arrives', () => {
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');
  const uploadSource = fs.readFileSync(new URL('../src/components/session/ReferenceUploadRequest.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /forceShowVoiceUpload/);
  assert.match(pageSource, /onShowUploadRequested/);
  assert.match(pageSource, /isVoiceMode && forceShowVoiceUpload/);
  assert.match(callSource, /onShowUploadRequested/);
  assert.match(uploadSource, /forceVisible/);
  assert.match(uploadSource, /Drop the reference here/);
});

test('voice upload layout requests also reveal the upload panel', () => {
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');

  assert.match(callSource, /if \(layout === 'upload'\) onShowUploadRequested\(\)/);
});

test('voice uploads notify the live avatar room after a reference lands', () => {
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');
  const uploadRouteSource = fs.readFileSync(new URL('../src/app/api/pipeline/upload/route.ts', import.meta.url), 'utf8');

  assert.match(pageSource, /voiceUploadNotice/);
  assert.match(pageSource, /setVoiceUploadNotice/);
  assert.match(pageSource, /voiceUploadNotice=\{voiceUploadNotice\}/);
  assert.match(callSource, /useRoomContext/);
  assert.match(callSource, /AvatarUploadNoticeBridge/);
  assert.match(callSource, /localParticipant\.sendText/);
  assert.match(callSource, /topic: 'lk\.chat'/);
  assert.match(uploadRouteSource, /uploadedReferences/);
  assert.match(uploadRouteSource, /session\.interview_medium !== 'voice'/);
});

test('voice upload layout releases after the upload panel is no longer visible', () => {
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');

  assert.match(callSource, /clientLayout === 'upload' && showUpload/);
  assert.doesNotMatch(callSource, /if \(clientLayout !== 'stage'\) return clientLayout/);
});

test('voice avatar sizing ignores free-floating docked layout events', () => {
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(callSource, /if \(clientLayout === 'docked'\) return 'docked'/);
  assert.match(callSource, /return docked \? 'docked' : 'stage'/);
});

test('voice session keeps avatar frame viewport-bound and scrolls transcript internally', () => {
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /h-\[100dvh\]/);
  assert.match(pageSource, /max-h-\[100dvh\]/);
  assert.match(callSource, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(callSource, /style=\{\{ aspectRatio: 'auto' \}\}/);
  assert.match(callSource, /data-avatar-transcript-scroll/);
  assert.match(callSource, /overflow-y-auto/);
});

test('voice live script cannot resize the avatar video column', () => {
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');

  assert.match(callSource, /data-avatar-video-shell/);
  assert.match(callSource, /data-avatar-script-panel/);
  assert.match(callSource, /lg:right-\[340px\]/);
  assert.doesNotMatch(callSource, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(300px,340px\)\]/);
  assert.match(callSource, /overflow-y-auto overflow-x-hidden/);
  assert.match(callSource, /\[overflow-wrap:anywhere\]/);
});

test('voice avatar video never crops in as transcript content changes', () => {
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');
  const cssSource = fs.readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

  assert.match(callSource, /data-avatar-video-fit="contain"/);
  assert.doesNotMatch(callSource, /object-cover/);
  assert.match(cssSource, /\[data-avatar-video-fit="contain"\] video/);
  assert.match(cssSource, /object-fit: contain !important/);
});

test('voice avatar player has an animated loading state', () => {
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');
  const cssSource = fs.readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

  assert.match(callSource, /useAvatarStatus/);
  assert.match(callSource, /credentials=\{connection\.credentials\}/);
  assert.match(callSource, /data-avatar-call/);
  assert.match(callSource, /data-avatar-custom-call/);
  assert.match(callSource, /AvatarStageLoadingOverlay/);
  assert.match(callSource, /Preparing Nico/);
  assert.match(callSource, /Syncing video signal/);
  assert.match(cssSource, /\[data-avatar-custom-call\] > div/);
  assert.match(cssSource, /flex: 1 1 auto/);
  assert.match(cssSource, /height: 100%/);
  assert.match(cssSource, /@keyframes avatar-loader-scan/);
  assert.match(cssSource, /\.avatar-loader-ring/);
});

test('voice live script exposes a visible scrollbar affordance', () => {
  const cssSource = fs.readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

  assert.match(cssSource, /\[data-avatar-transcript-scroll\]/);
  assert.match(cssSource, /scrollbar-gutter: stable/);
  assert.match(cssSource, /scrollbar-width: thin/);
  assert.match(cssSource, /::-webkit-scrollbar-thumb/);
});

test('voice session shows avatar connection progress and errors instead of a blank stage', () => {
  const callSource = fs.readFileSync(new URL('../src/components/session/AvatarDirectorCall.tsx', import.meta.url), 'utf8');

  assert.match(callSource, /connection\.status/);
  assert.match(callSource, /Preparing Nico/);
  assert.match(callSource, /Could not start director call/);
  assert.match(callSource, /credentials=\{connection\.credentials\}/);
  assert.doesNotMatch(callSource, /connect=\{connect\}/);
});

test('voice review panels are director-led without manual approval buttons', () => {
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');
  const outlineSource = fs.readFileSync(new URL('../src/components/session/SceneOutlineReview.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /isVoiceMode \? false : hasTreatmentAwaitingDecision/);
  assert.match(pageSource, /readOnly=\{isVoiceMode\}/);
  assert.match(outlineSource, /readOnly\?: boolean/);
  assert.match(outlineSource, /!readOnly &&/);
});

test('voice production handoff prompts for render notification email', () => {
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');
  const promptSource = fs.readFileSync(new URL('../src/components/session/RenderEmailPrompt.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /RenderEmailPrompt/);
  assert.match(pageSource, /\/api\/pipeline\/render-email/);
  assert.match(promptSource, /Where should I send the rendered film/);
  assert.match(promptSource, /render_notification_email/);
});

test('voice production handoff hides draft and progress surfaces behind email handoff', () => {
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /showVoiceProductionHandoff/);
  assert.match(pageSource, /VoiceProductionHandoff/);
  assert.match(pageSource, /!showVoiceProductionHandoff &&/);
});

test('render notification email prompt is available after production handoff in text and voice', () => {
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /const showRenderEmailPrompt = shouldOfferRenderNotificationEmail/);
  assert.match(pageSource, /!session\.render_notification_email/);
  assert.doesNotMatch(pageSource, /const showRenderEmailPrompt = isVoiceMode && shouldEndDirectorCall/);
});

test('render completion email points users to a finished render page', () => {
  const emailSource = fs.readFileSync(new URL('../src/lib/email/smtp.ts', import.meta.url), 'utf8');
  const notificationSource = fs.readFileSync(new URL('../src/lib/final-render-notification.ts', import.meta.url), 'utf8');
  const pageSource = fs.readFileSync(new URL('../src/app/render/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(emailSource, /\/render\/\$\{encodeURIComponent\(sessionId\)\}/);
  assert.match(emailSource, /Director's Cut website/);
  assert.match(notificationSource, /sessionId,/);
  assert.match(pageSource, /Your film is ready/);
  assert.match(pageSource, /final_video_url/);
  assert.match(pageSource, /Download film/);
});

test('home page checks whether live demo production is ready', () => {
  const source = fs.readFileSync(new URL('../src/components/home/StudioHome.tsx', import.meta.url), 'utf8');

  assert.match(source, /\/api\/pipeline\/readiness/);
  assert.match(source, /readiness\.userMessage/);
});

test('ambient fractal background is a client component with Escape Dust motion controls', () => {
  const source = fs.readFileSync(new URL('../src/components/AmbientFractalBackground.tsx', import.meta.url), 'utf8');

  assert.match(source, /^'use client';/);
  assert.match(source, /type AmbientFractalBackgroundProps/);
  assert.match(source, /intensity: 'landing' \| 'session'/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /escape-dust-shard/);
  assert.match(source, /escape-dust-micro-cell/);
});

test('home and session pages share the ambient fractal background with tuned intensity', () => {
  const homeSource = fs.readFileSync(new URL('../src/components/home/StudioHome.tsx', import.meta.url), 'utf8');
  const sessionSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(homeSource, /AmbientFractalBackground/);
  assert.match(homeSource, /intensity="landing"/);
  assert.match(sessionSource, /AmbientFractalBackground/);
  assert.match(sessionSource, /intensity="session"/);
  assert.doesNotMatch(sessionSource, /const \[particles\]/);
});
