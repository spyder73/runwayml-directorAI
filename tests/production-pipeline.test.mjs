import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('shot planner fallback splits long narration into bounded shots', () => {
  const { normalizeShotPlan } = jiti('../src/lib/shot_planner.ts');

  const shots = normalizeShotPlan('Wide shot of a railway platform at dusk.', 23.2);

  assert.ok(shots.length > 1);
  assert.equal(Math.ceil(shots.reduce((total, shot) => total + shot.duration, 0)), 24);
  for (const shot of shots) {
    assert.ok(shot.duration >= 2);
    assert.ok(shot.duration <= 10);
    assert.match(shot.prompt, /railway platform/);
  }
});

test('shot planner parses prose shot breakdowns when structured JSON generation fails', () => {
  const { parseShotPlanResponseText } = jiti('../src/lib/shot_planner.ts');

  const shots = parseShotPlanResponseText(
    "Okay, let's break down this 7-second scene into a series of shots.\n\n" +
      'Shot 1 (3 seconds):\n' +
      'Wide shot of a wet platform with flickering station lights in the background. The camera slowly pushes down toward a blue suitcase on the platform.\n\n' +
      'Shot 2 (4 seconds):\n' +
      'Close-up on the blue suitcase as the camera continues its slow push down the platform, with the flickering station lights visible in the background.',
    'The camera slowly pushes down a wet platform toward a blue suitcase.',
    7,
  );

  assert.deepEqual(shots.map((shot) => shot.duration), [3, 4]);
  assert.match(shots[0].prompt, /wet platform/);
  assert.match(shots[1].prompt, /blue suitcase/);
});

test('shot planner adds continuity image prompts for split scenes', () => {
  const { normalizeShotPlan } = jiti('../src/lib/shot_planner.ts');

  const shots = normalizeShotPlan('A train passes by on a rainy station platform.', 8, [
    { duration: 4, prompt: 'Wide shot as the train pulls away from the platform.' },
    { duration: 4, prompt: 'Reverse angle on the platform after the train has passed.' },
  ]);

  assert.equal(shots.length, 2);
  assert.match(shots[0].referencePrompt, /train/i);
  assert.match(shots[1].referencePrompt, /@opening_frame/);
  assert.match(shots[1].referencePrompt, /train/i);
  assert.doesNotMatch(shots[1].referencePrompt, /sub-scene|previous action|already occurred|do not reset|Base scene|This shot begins/i);
});

test('shot planner collapses weak short splits without a new perspective', () => {
  const { normalizeShotPlan } = jiti('../src/lib/shot_planner.ts');

  const shots = normalizeShotPlan(
    'Maya walks down a sidewalk at twilight, pauses beside a shop window, and smiles faintly at her reflection.',
    8,
    [
      { duration: 4, prompt: 'Wide shot following Maya from behind down a sidewalk at twilight.' },
      { duration: 4, prompt: 'Wide shot following Maya from behind down the same sidewalk at twilight.' },
    ],
  );

  assert.equal(shots.length, 1);
  assert.equal(shots[0].duration, 8);
  assert.match(shots[0].prompt, /shop window/);
});

test('shot planner collapses same-background frontal coverage despite vague angle reasons', () => {
  const { normalizeShotPlan } = jiti('../src/lib/shot_planner.ts');

  const shots = normalizeShotPlan(
    'Maya and Jonah laugh together outside the community college after class.',
    9,
    [
      {
        duration: 3,
        prompt: 'Frontal shot of Maya and Jonah laughing together against the same campus courtyard background.',
      },
      {
        duration: 3,
        prompt: 'Another frontal angle of Maya and Jonah laughing together against the same campus courtyard background.',
        angle_change_reason: 'The camera changes to another frontal angle to add variety.',
      },
      {
        duration: 3,
        prompt: 'A third frontal angle of Maya and Jonah laughing together against the same campus courtyard background.',
        angle_change_reason: 'The camera changes to a different frontal angle for coverage.',
      },
    ],
  );

  assert.equal(shots.length, 1);
  assert.equal(shots[0].duration, 9);
  assert.match(shots[0].prompt, /community college/);
});

test('shot planner uses visible start state for accepted continuation frames', () => {
  const { normalizeShotPlan } = jiti('../src/lib/shot_planner.ts');

  const shots = normalizeShotPlan(
    'Maya walks down a sidewalk at twilight, pauses beside a shop window, and smiles faintly at her reflection.',
    8,
    [
      {
        duration: 4,
        prompt: 'Tracking shot from behind as Maya walks down a sidewalk at twilight.',
        visual_end_state: 'Maya has reached the lit shop window and has slowed to a stop beside the glass.',
      },
      {
        duration: 4,
        prompt: 'Close-up from outside the shop window as Maya studies her reflection in the glass.',
        visual_start_state: 'Maya stands beside the lit shop window at twilight, her face and the city lights reflected in the glass.',
        angle_change_reason: 'The camera changes from a rear tracking view to an exterior close-up through the reflective window glass.',
      },
    ],
  );

  assert.equal(shots.length, 2);
  assert.equal(shots[1].visualStartState, 'Maya stands beside the lit shop window at twilight, her face and the city lights reflected in the glass.');
  assert.equal(
    shots[1].referencePrompt,
    'Using @opening_frame as the visual reference, Maya stands beside the lit shop window at twilight, her face and the city lights reflected in the glass.',
  );
  assert.doesNotMatch(shots[1].referencePrompt, /sub-scene|previous action|already occurred|do not reset|prompt:|reference_prompt:/i);
});

test('shot planner strips orchestration labels from generator prompts', () => {
  const { parseShotPlanResponseText } = jiti('../src/lib/shot_planner.ts');

  const shots = parseShotPlanResponseText(
    'Shot 1 (4 seconds):\n' +
      'prompt: Wide shot following Maya from behind as she walks down a sidewalk at twilight.\n' +
      'reference_prompt: A woman in a long coat walking down a city sidewalk at dusk, with lit shop windows in the background.\n\n' +
      'Shot 2 (4 seconds):\n' +
      'prompt: Close-up on Maya as she pauses near a shop window, her reflection overlaid against the city lights.\n' +
      'reference_prompt: A woman pauses near a shop window, her face reflected in the glass with city lights behind her.',
    'Walking shot following Maya from behind down a sidewalk at twilight.',
    8,
  );

  assert.equal(shots.length, 2);
  assert.equal(shots[0].prompt, 'Wide shot following Maya from behind as she walks down a sidewalk at twilight.');
  assert.equal(shots[1].prompt, 'Close-up on Maya as she pauses near a shop window, her reflection overlaid against the city lights.');
  assert.equal(shots[1].referencePrompt, 'A woman pauses near a shop window, her face reflected in the glass with city lights behind her.');
  for (const shot of shots) {
    assert.doesNotMatch(shot.prompt, /prompt:|reference_prompt:/i);
    assert.doesNotMatch(shot.referencePrompt, /prompt:|reference_prompt:|sub-scene|previous action|do not reset/i);
  }
});

test('continuity reference prompts are isolated generator instructions', () => {
  const { buildContinuityReferencePrompt } = jiti('../src/lib/pipeline_media.ts');

  const prompt = buildContinuityReferencePrompt({
    duration: 4,
    prompt: 'prompt: Close-up on Maya as she pauses near a shop window.\nreference_prompt: Maya paused near a shop window, her reflection visible in the glass.',
  }, 1);

  assert.equal(prompt, 'Using @opening_frame as the visual reference, Maya paused near a shop window, her reflection visible in the glass.');
  assert.doesNotMatch(prompt, /sub-scene|previous action|already occurred|do not reset|prompt:|reference_prompt:/i);
});

test('production references choose consented tagged assets and append prompt tags', () => {
  const { prepareSceneReferences } = jiti('../src/lib/production-references.ts');

  const references = prepareSceneReferences({
    promptText: 'Maya waits outside the school doors.',
    sceneReferenceAssetIds: ['self-id', 'school-id', 'denied-id'],
    protagonistVisible: true,
    assets: [
      { id: 'school-id', local_url: '/uploads/school.jpg', runway_uri: null, stable_tag: 'school_01', usage_permissions: 'allowed', target_type: 'place', vision_description: null },
      { id: 'denied-id', local_url: '/uploads/denied.jpg', runway_uri: null, stable_tag: 'denied_01', usage_permissions: 'denied', target_type: 'person', vision_description: null },
      { id: 'self-id', local_url: '/uploads/maya.jpg', runway_uri: null, stable_tag: 'self', usage_permissions: 'allowed', target_type: 'protagonist', vision_description: null },
    ],
  });

  assert.deepEqual(references.selectedAssets.map((asset) => asset.id), ['self-id', 'school-id']);
  assert.equal(references.referenceImages.length, 2);
  assert.match(references.promptText, /@self/);
  assert.match(references.promptText, /@school_01/);
  assert.doesNotMatch(references.promptText, /@denied_01/);
});

test('production references rewrite prompt entity aliases to usable owned image assets', () => {
  const { prepareSceneReferences } = jiti('../src/lib/production-references.ts');

  const references = prepareSceneReferences({
    promptText: 'Warm Heidelberg light with Lenos and @kareem walking after class.',
    sceneReferenceAssetIds: [],
    protagonistVisible: false,
    assets: [
      { id: 'kareem-description', local_url: null, runway_uri: null, stable_tag: 'kareem', usage_permissions: 'description_only', target_type: 'friend', owner_entity_id: 'kareem-entity', vision_description: 'Kareem from Heidelberg.' },
      { id: 'kareem-upload', local_url: '/uploads/kareem.jpg', runway_uri: null, stable_tag: 'friend_kareem', usage_permissions: 'allowed', target_type: 'friend', owner_entity_id: 'kareem-entity', vision_description: 'Kareem laughing in warm light.' },
    ],
    entities: [
      { id: 'kareem-entity', display_name: 'Kareem', reference_asset_id: 'kareem-description' },
    ],
  });

  assert.deepEqual(references.selectedAssets.map((asset) => asset.id), ['kareem-upload']);
  assert.deepEqual(references.referenceImages.map((image) => image.tag), ['friend_kareem']);
  assert.match(references.promptText, /@friend_kareem/);
  assert.doesNotMatch(references.promptText, /@kareem\b/);
});

test('final render plan produces a real output path and Remotion inputs', () => {
  const { buildFinalRenderPlan } = jiti('../src/lib/final-render.ts');

  const plan = buildFinalRenderPlan({
    sessionId: 'session-1',
    aspectRatio: '9:16',
    scenes: [
      {
        id: 'scene-1',
        scene_index: 0,
        narrator_text: 'First line.',
        video_url: JSON.stringify(['/generated/video/session-1/shot-1.mp4', '/generated/video/session-1/shot-2.mp4']),
        shot_plan_json: JSON.stringify([{ duration: 3 }, { duration: 5 }]),
        audio_url: '/generated/audio/session-1/scene-1.mp3',
        duration: 8,
      },
    ],
  });

  assert.equal(plan.publicUrl.startsWith('/generated/final/session-1/'), true);
  assert.equal(plan.outputFilePath.endsWith('.mp4'), true);
  assert.deepEqual(plan.videoInputs.map((input) => input.publicUrl), [
    '/generated/video/session-1/shot-1.mp4',
    '/generated/video/session-1/shot-2.mp4',
  ]);
  assert.deepEqual(plan.audioInputs.map((input) => input.publicUrl), ['/generated/audio/session-1/scene-1.mp3']);
  assert.equal(plan.composition.width, 720);
  assert.equal(plan.composition.height, 1280);
  assert.equal(plan.remotionInputProps.scenes[0].clips[0].url, '/public/generated/video/session-1/shot-1.mp4');
  assert.equal(plan.remotionInputProps.scenes[0].audio_url, '/public/generated/audio/session-1/scene-1.mp3');
  assert.deepEqual(plan.remotionInputProps.scenes[0].clips.map((clip) => clip.duration_in_frames), [90, 150]);
  assert.equal(plan.remotionInputProps.scenes[0].duration_in_frames, 240);
});

test('final render quality preset can lower output dimensions for faster local renders', () => {
  const { buildFinalRenderPlan } = jiti('../src/lib/final-render.ts');
  const originalQuality = process.env.REMOTION_RENDER_QUALITY;
  process.env.REMOTION_RENDER_QUALITY = 'fast';

  try {
    const landscapePlan = buildFinalRenderPlan({
      sessionId: 'session-1',
      aspectRatio: '16:9',
      scenes: [
        {
          id: 'scene-1',
          scene_index: 0,
          narrator_text: 'First line.',
          video_url: JSON.stringify(['/generated/video/session-1/shot-1.mp4']),
          shot_plan_json: JSON.stringify([{ duration: 3 }]),
          audio_url: '/generated/audio/session-1/scene-1.mp3',
          duration: 3,
        },
      ],
    });
    const portraitPlan = buildFinalRenderPlan({
      sessionId: 'session-1',
      aspectRatio: '9:16',
      scenes: [
        {
          id: 'scene-1',
          scene_index: 0,
          narrator_text: 'First line.',
          video_url: JSON.stringify(['/generated/video/session-1/shot-1.mp4']),
          shot_plan_json: JSON.stringify([{ duration: 3 }]),
          audio_url: '/generated/audio/session-1/scene-1.mp3',
          duration: 3,
        },
      ],
    });

    assert.equal(landscapePlan.composition.width, 960);
    assert.equal(landscapePlan.composition.height, 540);
    assert.equal(portraitPlan.composition.width, 540);
    assert.equal(portraitPlan.composition.height, 960);
  } finally {
    if (originalQuality === undefined) {
      delete process.env.REMOTION_RENDER_QUALITY;
    } else {
      process.env.REMOTION_RENDER_QUALITY = originalQuality;
    }
  }
});

test('final render ultra quality preset renders full HD dimensions', () => {
  const { buildFinalRenderPlan } = jiti('../src/lib/final-render.ts');
  const originalQuality = process.env.REMOTION_RENDER_QUALITY;
  process.env.REMOTION_RENDER_QUALITY = 'ultra';

  try {
    const landscapePlan = buildFinalRenderPlan({
      sessionId: 'session-1',
      aspectRatio: '16:9',
      scenes: [
        {
          id: 'scene-1',
          scene_index: 0,
          narrator_text: 'First line.',
          video_url: JSON.stringify(['/generated/video/session-1/shot-1.mp4']),
          shot_plan_json: JSON.stringify([{ duration: 3 }]),
          audio_url: '/generated/audio/session-1/scene-1.mp3',
          duration: 3,
        },
      ],
    });
    const portraitPlan = buildFinalRenderPlan({
      sessionId: 'session-1',
      aspectRatio: '9:16',
      scenes: [
        {
          id: 'scene-1',
          scene_index: 0,
          narrator_text: 'First line.',
          video_url: JSON.stringify(['/generated/video/session-1/shot-1.mp4']),
          shot_plan_json: JSON.stringify([{ duration: 3 }]),
          audio_url: '/generated/audio/session-1/scene-1.mp3',
          duration: 3,
        },
      ],
    });

    assert.equal(landscapePlan.composition.width, 1920);
    assert.equal(landscapePlan.composition.height, 1080);
    assert.equal(portraitPlan.composition.width, 1080);
    assert.equal(portraitPlan.composition.height, 1920);
  } finally {
    if (originalQuality === undefined) {
      delete process.env.REMOTION_RENDER_QUALITY;
    } else {
      process.env.REMOTION_RENDER_QUALITY = originalQuality;
    }
  }
});

test('final render crf resolution never sends h264-unsupported zero', () => {
  const { resolveRemotionCrf } = jiti('../src/lib/final-render.ts');
  const originalCrf = process.env.REMOTION_CRF;
  const originalQuality = process.env.REMOTION_RENDER_QUALITY;

  try {
    delete process.env.REMOTION_CRF;
    delete process.env.REMOTION_RENDER_QUALITY;
    assert.equal(resolveRemotionCrf(), 20);

    process.env.REMOTION_RENDER_QUALITY = 'fast';
    assert.equal(resolveRemotionCrf(), 28);

    process.env.REMOTION_CRF = '0';
    assert.equal(resolveRemotionCrf(), 1);

    process.env.REMOTION_CRF = '17';
    assert.equal(resolveRemotionCrf(), 17);
  } finally {
    if (originalCrf === undefined) {
      delete process.env.REMOTION_CRF;
    } else {
      process.env.REMOTION_CRF = originalCrf;
    }
    if (originalQuality === undefined) {
      delete process.env.REMOTION_RENDER_QUALITY;
    } else {
      process.env.REMOTION_RENDER_QUALITY = originalQuality;
    }
  }
});

test('final render exposes Remotion progress callbacks', () => {
  const source = fs.readFileSync(new URL('../src/lib/final-render.ts', import.meta.url), 'utf8');

  assert.match(source, /export type FinalRenderProgress/);
  assert.match(source, /onProgress\?: \(progress: FinalRenderProgress\) => void/);
  assert.match(source, /plan\.onProgress\?\.\(/);
  assert.match(source, /renderedFrames/);
  assert.match(source, /encodedFrames/);
  assert.match(source, /totalFrames/);
  assert.match(source, /stitchStage/);
});

test('final render plan sends readable subtitles into the Remotion composition', () => {
  const { buildFinalRenderPlan } = jiti('../src/lib/final-render.ts');

  const plan = buildFinalRenderPlan({
    sessionId: 'session-1',
    aspectRatio: '16:9',
    scenes: [
      {
        id: 'scene-1',
        scene_index: 0,
        narrator_text: 'The train was already leaving, and the platform felt impossibly quiet.',
        video_url: JSON.stringify(['/generated/video/session-1/shot-1.mp4']),
        shot_plan_json: JSON.stringify([{ duration: 6 }]),
        audio_url: '/generated/audio/session-1/scene-1.mp3',
        duration: 6,
      },
    ],
  });

  assert.equal(plan.remotionInputProps.scenes.length, 1);
  assert.match(plan.remotionInputProps.scenes[0].narrator_text, /train was already leaving/);
  assert.equal(plan.remotionInputProps.scenes[0].duration_in_frames, 180);
  assert.equal(plan.composition.id, 'LifeStoryFilm');
});

test('final render plan gently speeds narration when it is longer than planned clip time', () => {
  const { buildFinalRenderPlan } = jiti('../src/lib/final-render.ts');

  const plan = buildFinalRenderPlan({
    sessionId: 'session-1',
    aspectRatio: '16:9',
    scenes: [
      {
        id: 'scene-1',
        scene_index: 0,
        narrator_text: 'First line.',
        video_url: JSON.stringify(['/generated/video/session-1/shot-1.mp4', '/generated/video/session-1/shot-2.mp4']),
        shot_plan_json: JSON.stringify([{ duration: 3 }, { duration: 3 }]),
        audio_url: '/generated/audio/session-1/scene-1.mp3',
        duration: 6.4,
      },
    ],
  });

  assert.equal(plan.audioInputs[0].targetDuration, 6);
  assert.ok(plan.audioInputs[0].tempo && plan.audioInputs[0].tempo > 1);
  assert.equal(Number(plan.audioInputs[0].tempo.toFixed(3)), 1.067);
  assert.equal(Number(plan.remotionInputProps.scenes[0].audio_playback_rate?.toFixed(3)), 1.067);
});

test('final render bundle resolver reuses one in-flight bundle', async () => {
  const { createRemotionBundleResolver } = jiti('../src/lib/final-render.ts');
  let bundleCalls = 0;
  let resolveBundle;
  const bundleStarted = new Promise((resolve) => {
    resolveBundle = resolve;
  });
  const resolveBundlePath = createRemotionBundleResolver(async () => {
    bundleCalls += 1;
    return bundleStarted;
  });

  const first = resolveBundlePath({ entryPoint: '/tmp/remotion-entry.tsx' });
  const second = resolveBundlePath({ entryPoint: '/tmp/remotion-entry.tsx' });
  resolveBundle('/tmp/remotion-bundle');

  assert.equal(await first, '/tmp/remotion-bundle');
  assert.equal(await second, '/tmp/remotion-bundle');
  assert.equal(bundleCalls, 1);
});

test('final render uses media extraction components and fast x264 settings', () => {
  const compositionSource = fs.readFileSync(new URL('../src/remotion/MainComposition.tsx', import.meta.url), 'utf8');
  const renderSource = fs.readFileSync(new URL('../src/lib/final-render.ts', import.meta.url), 'utf8');

  assert.match(compositionSource, /from ['"]@remotion\/media['"]/);
  assert.match(compositionSource, /<Video[^>]+muted/);
  assert.match(compositionSource, /objectFit=["']cover["']/);
  assert.match(renderSource, /'veryfast'/);
  assert.match(renderSource, /'superfast'/);
  assert.match(renderSource, /REMOTION_RENDER_QUALITY/);
  assert.match(renderSource, /x264Preset/);
  assert.match(renderSource, /onProgress:/);
});

test('Runway video model can be configured from the environment', () => {
  const { DEFAULT_VIDEO_MODEL, getRunwayVideoModel } = jiti('../src/lib/production-config.ts');

  assert.equal(getRunwayVideoModel({}), DEFAULT_VIDEO_MODEL);
  assert.equal(getRunwayVideoModel({ video_model: 'veo3.1_fast' }), 'veo3.1_fast');
  assert.equal(getRunwayVideoModel({ video_model: 'gen4_aleph' }), 'gen4_aleph');
  assert.equal(getRunwayVideoModel({ VIDEO_MODEL: 'gen4_turbo' }), 'gen4_turbo');
  assert.equal(getRunwayVideoModel({ RUNWAY_VIDEO_MODEL: 'gen4_aleph' }), 'gen4_aleph');
});

test('Runway video task helper normalizes Veo 3.1 Fast payload constraints', async () => {
  const {
    createImageToVideoTask,
    runwayVideoDuration,
    runwayVideoRatio,
  } = jiti('../src/lib/runway.ts');
  const { RUNWAY_TASK_CREATE_TIMEOUT_MS } = jiti('../src/lib/production-config.ts');
  const resource = {
    create(body, options) {
      assert.equal(body.model, 'veo3.1_fast');
      assert.equal(body.ratio, '1080:1920');
      assert.equal(body.duration, 6);
      assert.equal(options.timeout, RUNWAY_TASK_CREATE_TIMEOUT_MS);
      return Promise.resolve({ id: 'task-1' });
    },
  };

  assert.equal(runwayVideoDuration('veo3.1_fast', 3.1), 4);
  assert.equal(runwayVideoDuration('veo3.1_fast', 5), 6);
  assert.equal(runwayVideoDuration('veo3.1_fast', 7.2), 8);
  assert.equal(runwayVideoDuration('veo3.1_fast', 9.8), 8);
  assert.equal(runwayVideoRatio('veo3.1_fast', '720:1280'), '1080:1920');
  assert.equal(runwayVideoRatio('veo3.1_fast', '1280:720'), '1920:1080');

  const task = await createImageToVideoTask(resource, {
    model: 'veo3.1_fast',
    promptImageUri: 'runway://asset',
    promptText: 'The camera slowly drifts forward.',
    ratio: '720:1280',
    duration: 5,
  });

  assert.equal(task.id, 'task-1');
});

test('Runway image task helper preserves the SDK resource client binding', async () => {
  const { createTextToImageTask } = jiti('../src/lib/runway.ts');
  const { RUNWAY_TASK_CREATE_TIMEOUT_MS } = jiti('../src/lib/production-config.ts');
  const resource = {
    _client: { ok: true },
    create(body, options) {
      assert.equal(this._client.ok, true);
      assert.equal(body.model, 'gpt_image_2');
      assert.equal(options.timeout, RUNWAY_TASK_CREATE_TIMEOUT_MS);
      return Promise.resolve({ id: 'task-1' });
    },
  };

  const task = await createTextToImageTask(resource, {
    promptText: 'A warm kitchen memory.',
    quality: 'low',
    ratio: '1920:1088',
    sessionId: 'session-1',
  });

  assert.equal(task.id, 'task-1');
});

test('Runway image references upload oversized data URIs before task creation', async () => {
  const {
    prepareRunwayReferenceImages,
    RUNWAY_REFERENCE_DATA_URI_MAX_LENGTH,
  } = jiti('../src/lib/runway.ts');
  const oversizedUri = `data:image/jpeg;base64,${'a'.repeat(RUNWAY_REFERENCE_DATA_URI_MAX_LENGTH)}`;
  const smallUri = 'data:image/jpeg;base64,abc';
  const uploadedUris = [];

  const prepared = await prepareRunwayReferenceImages([
    { tag: 'opening_frame', uri: oversizedUri },
    { tag: 'self', uri: smallUri },
  ], async (uri) => {
    uploadedUris.push(uri);
    return 'runway://uploaded-opening-frame';
  });

  assert.deepEqual(uploadedUris, [oversizedUri]);
  assert.deepEqual(prepared, [
    { tag: 'opening_frame', uri: 'runway://uploaded-opening-frame' },
    { tag: 'self', uri: smallUri },
  ]);
});
