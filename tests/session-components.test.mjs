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
  assert.match(source, /const showComposer = !showReferenceRequest \|\| isReferenceDescribeDraft;/);
  assert.match(source, /\{!isReferenceDescribeDraft && \(\s*<ReferenceUploadRequest/);
  assert.match(source, /\{showComposer && \(\s*<form/);
});

test('production progress exposes frame approval before motion generation', () => {
  const source = fs.readFileSync(new URL('../src/components/session/ProductionProgress.tsx', import.meta.url), 'utf8');
  const pageSource = fs.readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /Approve frames/i);
  assert.match(source, /onApproveFrames/);
  assert.match(source, /Frame notes/i);
  assert.match(pageSource, /\/api\/pipeline\/synthesize/);
});

test('production progress exposes unit retry controls for failed scene work', () => {
  const source = fs.readFileSync(new URL('../src/components/session/ProductionProgress.tsx', import.meta.url), 'utf8');

  assert.match(source, /Retry frame/);
  assert.match(source, /Retry narration/);
  assert.match(source, /Retry motion/);
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
  assert.match(source, /handleStart\(\)/);
  assert.doesNotMatch(source, /handleStart\('single_memory'\)/);
  assert.doesNotMatch(source, /Generate a Video of a Memory/);
  assert.doesNotMatch(source, /\/api\/pipeline\/demo/);
  assert.doesNotMatch(source, /Open rehearsal memory/);
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
