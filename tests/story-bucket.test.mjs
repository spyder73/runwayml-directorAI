import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  applyProfileBucketUpdate,
  addReferenceSubject,
  createReferenceAsset,
  createReferenceUploadRequest,
  getActiveReferenceRequest,
  hasProtagonistReferenceDecision,
  initializeStoryBucketTables,
  loadStoryBucket,
  lockSceneOutlineForProduction,
  markActiveReferenceRequest,
  proposeFilmTreatment,
  proposeSceneOutline,
} = jiti('../src/lib/story-bucket.ts');

function createDb() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'life_story',
      status TEXT NOT NULL,
      story_text TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      clarify_question TEXT,
      user_name TEXT,
      user_age TEXT,
      user_selfie_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE scenes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      scene_index INTEGER NOT NULL,
      narrator_text TEXT NOT NULL,
      visual_prompt TEXT NOT NULL,
      image_prompt TEXT,
      video_prompt TEXT,
      duration INTEGER,
      scene_references TEXT,
      reference_image_url TEXT,
      video_url TEXT,
      audio_url TEXT,
      status TEXT DEFAULT 'pending',
      is_protagonist_visible BOOLEAN DEFAULT 1
    );
  `);

  db.prepare('INSERT INTO sessions (id, status, story_text, aspect_ratio, mode) VALUES (?, ?, ?, ?, ?)')
    .run('session-1', 'INTERVIEW_ONBOARDING', '', '16:9', 'life_story');

  initializeStoryBucketTables(db);
  return db;
}

function addTreatment(db) {
  proposeFilmTreatment(db, 'session-1', {
    title: 'A Small Film',
    emotionalThesis: 'A memory shaped by quiet courage.',
    narrativeArc: 'arrival to recognition to release',
    visualMotif: 'warm light and thresholds',
    narratorStyle: 'restrained documentary warmth',
    endingFeeling: 'gentle gratitude',
    avoid: ['generic montage'],
  });
}

test('profile bucket update persists profile, entities, themes, and memory candidates', () => {
  const db = createDb();

  applyProfileBucketUpdate(db, 'session-1', {
    profile: {
      protagonistName: 'Maya',
      age: '41',
      profession: 'architect',
      currentLocation: 'Berlin',
      lifePhase: 'starting over in a new city',
      emotionalTone: 'hopeful but guarded',
      themes: ['belonging', 'reinvention'],
      summary: 'Maya is rebuilding a life around a quieter kind of courage.',
    },
    entities: [
      {
        type: 'person',
        displayName: 'Aunt Lena',
        relationship: 'raised Maya after school',
        description: 'Warm, exacting, always smelled faintly of cedar.',
        consentState: 'unknown',
      },
    ],
    memoryCandidates: [
      {
        title: 'The bus station goodbye',
        description: 'Maya leaving home with one suitcase.',
        emotionalPurpose: 'the first break from the old life',
        visualSummary: 'fluorescent lights, wet pavement, blue suitcase',
        referencesNeeded: ['protagonist', 'bus station'],
      },
    ],
  });

  const bucket = loadStoryBucket(db, 'session-1');

  assert.equal(bucket.profile?.protagonist_name, 'Maya');
  assert.equal(bucket.profile?.age, '41');
  assert.equal(bucket.profile?.profession, 'architect');
  assert.equal(bucket.profile?.current_location, 'Berlin');
  assert.deepEqual(JSON.parse(bucket.profile?.themes_json || '[]'), ['belonging', 'reinvention']);
  assert.equal(bucket.entities[0]?.display_name, 'Aunt Lena');
  assert.equal(bucket.memoryCandidates[0]?.title, 'The bus station goodbye');
});

test('scene outline adds standard protagonist intro and outro scenes', () => {
  const db = createDb();
  addTreatment(db);

  applyProfileBucketUpdate(db, 'session-1', {
    profile: {
      protagonistName: 'Dorian',
      profession: 'scientist',
      currentLocation: 'Cologne',
      emotionalTone: 'curious and reflective',
    },
  });
  const protagonist = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/dorian.jpg',
    stableTag: 'dorian',
    targetType: 'protagonist',
    targetLabel: 'Dorian',
    usagePermissions: 'allowed',
  });

  const outline = proposeSceneOutline(db, 'session-1', {
    scenes: [
      {
        title: 'The discovery',
        summary: 'Dorian follows the question that shaped his work.',
        narratorText: 'The question would not let him sleep, and eventually it became a calling.',
        imagePrompt: 'Dorian studies a notebook under a bright night sky.',
        videoPrompt: 'The camera slowly pushes toward Dorian as stars turn overhead.',
        duration: 6,
        emotionalPurpose: 'curiosity becomes direction',
        referenceAssetIds: [protagonist.id],
        protagonistVisible: true,
      },
    ],
  });

  assert.equal(outline.length, 3);
  assert.match(outline[0].title, /This Is Dorian/i);
  assert.match(outline[0].narrator_text, /This is Dorian/i);
  assert.match(outline[0].image_prompt, /@dorian/);
  assert.match(outline[0].image_prompt, /medium-wide three-quarter/i);
  assert.match(outline[0].video_prompt, /fade in from black/i);
  assert.equal(outline[1].title, 'The discovery');
  assert.match(outline[2].title, /Dorian.*Story So Far/i);
  assert.match(outline[2].narrator_text, /story so far/i);
  assert.match(outline[2].narrator_text, /history books/i);
  assert.match(outline[2].video_prompt, /same medium-wide three-quarter/i);
  db.close();
});

test('reference assets get stable unique tags and attach to active requests', () => {
  const db = createDb();

  const first = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/maya.jpg',
    targetType: 'protagonist',
    targetLabel: 'Maya',
    visionDescription: 'A woman in a green coat, soft window light.',
    usagePermissions: 'allowed',
  });

  const second = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/maya-2.jpg',
    targetType: 'protagonist',
    targetLabel: 'Maya',
    visionDescription: 'Another portrait of Maya.',
    usagePermissions: 'allowed',
  });

  assert.match(first.stable_tag, /^[a-z][a-z0-9_]+$/);
  assert.match(second.stable_tag, /^[a-z][a-z0-9_]+$/);
  assert.notEqual(first.stable_tag, second.stable_tag);
});

test('reference asset tags are lowercase runway-safe and capped to sixteen characters', () => {
  const db = createDb();

  const asset = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/school.jpg',
    targetType: 'very important childhood school building',
    targetLabel: 'The North-East Hallway From 1997',
    visionDescription: 'A long school hallway with old lockers.',
    usagePermissions: 'allowed',
  });

  assert.match(asset.stable_tag, /^[a-z][a-z0-9_]{2,15}$/);
  assert.ok(asset.stable_tag.length <= 16);
});

test('reference subjects attach uploaded assets to named entities and stable tags', () => {
  const db = createDb();
  const upload = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/agata.jpg',
    targetType: 'reference',
    targetLabel: 'reference',
    visionDescription: 'A smiling woman in a red coat.',
    usagePermissions: 'allowed',
  });

  const result = addReferenceSubject(db, 'session-1', {
    referenceAssetId: upload.id,
    subjectType: 'friend',
    displayName: 'Agata',
    relationship: 'school friend',
    description: 'Warm, funny, always wearing bold colors.',
    consentState: 'allowed',
  });
  const bucket = loadStoryBucket(db, 'session-1');
  const linkedAsset = bucket.referenceAssets.find((asset) => asset.id === upload.id);

  assert.equal(result.entity.display_name, 'Agata');
  assert.equal(result.entity.reference_asset_id, upload.id);
  assert.equal(linkedAsset?.owner_entity_id, result.entity.id);
  assert.equal(linkedAsset?.stable_tag, 'agata');
  assert.equal(linkedAsset?.target_type, 'friend');
  assert.equal(linkedAsset?.usage_permissions, 'allowed');
});

test('reference subjects are idempotent when the same named subject is labeled again', () => {
  const db = createDb();
  const upload = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/dorian.jpg',
    targetType: 'reference',
    targetLabel: 'reference',
    visionDescription: 'Dorian at a Berlin club night.',
    usagePermissions: 'allowed',
  });

  const first = addReferenceSubject(db, 'session-1', {
    referenceAssetId: upload.id,
    subjectType: 'friend',
    displayName: 'Dorian',
    description: 'Friend from Berlin festival nights.',
    consentState: 'allowed',
  });
  const second = addReferenceSubject(db, 'session-1', {
    subjectType: 'friend',
    displayName: 'Dorian',
    description: 'Friend from Berlin festival nights.',
    consentState: 'allowed',
  });
  const bucket = loadStoryBucket(db, 'session-1');

  assert.equal(second.entity.id, first.entity.id);
  assert.equal(second.referenceAsset.id, first.referenceAsset.id);
  assert.equal(bucket.referenceAssets.filter((asset) => asset.stable_tag.startsWith('dorian')).length, 1);
  assert.equal(bucket.referenceAssets[0].stable_tag, 'dorian');
});

test('reference subjects can resolve visible prompt tags with @ prefixes', () => {
  const db = createDb();
  const upload = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/old-school.jpg',
    targetType: 'reference',
    targetLabel: 'Old School',
    visionDescription: 'A brick school building with tall windows.',
    usagePermissions: 'allowed',
  });

  const result = addReferenceSubject(db, 'session-1', {
    referenceTag: `@${upload.stable_tag}`,
    subjectType: 'school',
    displayName: 'Northview School',
    description: 'A brick school building with tall windows.',
    consentState: 'allowed',
  });

  const linkedAsset = loadStoryBucket(db, 'session-1').referenceAssets.find((asset) => asset.id === upload.id);

  assert.equal(result.referenceAsset.id, upload.id);
  assert.equal(linkedAsset?.owner_entity_id, result.entity.id);
  assert.equal(linkedAsset?.stable_tag, 'northview_school');
});

test('entity-scoped upload requests attach uploaded images to the story entity', () => {
  const db = createDb();

  applyProfileBucketUpdate(db, 'session-1', {
    entities: [
      {
        id: 'kareem-entity',
        type: 'friend',
        displayName: 'Kareem',
        relationship: 'friend from Heidelberg',
        consentState: 'allowed',
      },
    ],
  });

  createReferenceUploadRequest(db, 'session-1', {
    targetType: 'friend',
    targetLabel: 'Kareem',
    entityId: 'kareem-entity',
    promptText: 'A photo of Kareem could help keep him visually consistent.',
    reason: 'Kareem appears in the Heidelberg scene.',
  });

  const upload = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/kareem.jpg',
    targetType: 'friend',
    targetLabel: 'Kareem',
    usagePermissions: 'allowed',
  });
  const entity = db.prepare('SELECT * FROM story_entities WHERE id = ?').get('kareem-entity');

  assert.equal(upload.stable_tag, 'kareem');
  assert.equal(upload.owner_entity_id, 'kareem-entity');
  assert.equal(entity.reference_asset_id, upload.id);
});

test('protagonist reference decision is true after upload request, upload, or description', () => {
  const db = createDb();

  assert.equal(hasProtagonistReferenceDecision(db, 'session-1'), false);

  createReferenceUploadRequest(db, 'session-1', {
    targetType: 'protagonist',
    targetLabel: 'Maya',
    promptText: 'Would you like to add a photo of yourself?',
    reason: 'This can help visible protagonist scenes.',
  });

  assert.equal(hasProtagonistReferenceDecision(db, 'session-1'), false);
  markActiveReferenceRequest(db, 'session-1', 'skipped');

  assert.equal(hasProtagonistReferenceDecision(db, 'session-1'), true);
});

test('opening protagonist request can be shown without leaving onboarding', () => {
  const db = createDb();

  createReferenceUploadRequest(db, 'session-1', {
    targetType: 'protagonist',
    targetLabel: 'Maya',
    promptText: 'Would you like to add a photo of yourself?',
    reason: 'This can help visible protagonist scenes.',
  }, { updateSessionStatus: false });

  const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1');
  assert.equal(session.status, 'INTERVIEW_ONBOARDING');
  assert.equal(getActiveReferenceRequest(db, 'session-1')?.target_type, 'protagonist');
  assert.equal(hasProtagonistReferenceDecision(db, 'session-1'), false);
});

test('protagonist upload request does not repeat after a fulfilled selfie unless scene-specific', () => {
  const db = createDb();

  createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/maya.jpg',
    targetType: 'protagonist',
    targetLabel: 'Maya',
    usagePermissions: 'allowed',
  });

  createReferenceUploadRequest(db, 'session-1', {
    targetType: 'protagonist',
    targetLabel: 'Maya',
    promptText: 'Would you like to add another photo?',
    reason: 'A protagonist reference can help visible scenes.',
  });

  assert.equal(getActiveReferenceRequest(db, 'session-1'), undefined);

  createReferenceUploadRequest(db, 'session-1', {
    targetType: 'protagonist',
    targetLabel: 'Maya in the school scene',
    promptText: 'For the school scene, a different photo could help if you want that era to feel specific.',
    reason: 'This is for a specific school-era scene.',
    referenceScope: 'scene',
    sceneTitle: 'School hallway',
  });

  const request = getActiveReferenceRequest(db, 'session-1');
  assert.equal(request?.target_label, 'Maya in the school scene');
  assert.equal(request?.reference_scope, 'scene');
  assert.equal(request?.scene_title, 'School hallway');
});

test('locking an outline creates production scenes and moves session to image generation', () => {
  const db = createDb();
  addTreatment(db);

  proposeSceneOutline(db, 'session-1', {
    scenes: [
      {
        title: 'Opening the suitcase',
        summary: 'Maya opens the suitcase in a rented room.',
        narratorText: 'She arrived with almost nothing, which made every object feel chosen.',
        imagePrompt: 'A cinematic rented room with a blue suitcase open on the bed.',
        videoPrompt: 'Slow push toward the suitcase as morning light crosses the room.',
        duration: 6,
        emotionalPurpose: 'beginning again',
        referenceNeeds: ['protagonist'],
        protagonistVisible: true,
      },
    ],
  });

  const result = lockSceneOutlineForProduction(db, 'session-1');
  const scene = db.prepare('SELECT * FROM scenes WHERE session_id = ?').get('session-1');
  const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1');

  assert.equal(result.createdScenes, 1);
  assert.equal(scene.narrator_text, 'She arrived with almost nothing, which made every object feel chosen.');
  assert.equal(scene.scene_references, '["protagonist"]');
  assert.equal(session.status, 'GENERATING_IMAGES');
});

test('locking an outline stores selected reference asset ids and generated tags on production scenes', () => {
  const db = createDb();
  addTreatment(db);

  const protagonist = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/maya.jpg',
    stableTag: 'self',
    targetType: 'protagonist',
    targetLabel: 'Maya',
    usagePermissions: 'allowed',
  });

  const school = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/school.jpg',
    stableTag: 'school_01',
    targetType: 'place',
    targetLabel: 'School',
    usagePermissions: 'allowed',
  });

  proposeSceneOutline(db, 'session-1', {
    scenes: [
      {
        title: 'The hallway',
        summary: 'Maya remembers walking through school alone.',
        narratorText: 'The hallway seemed longer when she was alone.',
        imagePrompt: 'A cinematic school hallway with Maya in soft light.',
        videoPrompt: 'Slow tracking shot through lockers toward Maya.',
        duration: 7,
        referenceNeeds: ['protagonist', 'school'],
        referenceAssetIds: [protagonist.id, school.id],
        protagonistVisible: true,
      },
    ],
  });

  lockSceneOutlineForProduction(db, 'session-1');
  const scene = db.prepare('SELECT * FROM scenes WHERE session_id = ?').get('session-1');

  assert.deepEqual(JSON.parse(scene.scene_references), [protagonist.id, school.id]);
  assert.deepEqual(JSON.parse(scene.reference_tags), ['self', 'school_01']);
});

test('locking an outline resolves prompt-only entity tags to usable owned reference images', () => {
  const db = createDb();
  addTreatment(db);

  applyProfileBucketUpdate(db, 'session-1', {
    entities: [
      {
        id: 'kareem-entity',
        type: 'friend',
        displayName: 'Kareem',
        relationship: 'friend from Heidelberg',
        consentState: 'allowed',
      },
    ],
  });

  const upload = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/kareem.jpg',
    stableTag: 'friend_kareem',
    targetType: 'friend',
    targetLabel: 'Kareem',
    ownerEntityId: 'kareem-entity',
    usagePermissions: 'allowed',
  });

  proposeSceneOutline(db, 'session-1', {
    scenes: [
      {
        title: 'The Heidelberg pause',
        summary: 'Lenos and Kareem laugh in warm light after language class.',
        narratorText: 'In Heidelberg, Kareem made the pause feel light.',
        imagePrompt: 'Warm golden-hour Heidelberg street. Use @kareem for visual consistency.',
        videoPrompt: 'The camera slowly follows two friends as they walk and laugh.',
        duration: 6,
        referenceNeeds: [],
        referenceAssetIds: [],
        protagonistVisible: false,
      },
    ],
  });

  lockSceneOutlineForProduction(db, 'session-1');
  const scene = db.prepare('SELECT * FROM scenes WHERE session_id = ?').get('session-1');

  assert.deepEqual(JSON.parse(scene.scene_references), [upload.id]);
  assert.deepEqual(JSON.parse(scene.reference_tags), ['friend_kareem']);
  assert.match(scene.image_prompt, /@friend_kareem/);
  assert.doesNotMatch(scene.image_prompt, /@kareem\b/);
});

test('locking an outline resolves plain named entities to usable owned reference images', () => {
  const db = createDb();
  addTreatment(db);

  applyProfileBucketUpdate(db, 'session-1', {
    profile: {
      protagonistName: 'Martin',
    },
    entities: [
      {
        id: 'dorian-entity',
        type: 'friend',
        displayName: 'Dorian',
        relationship: 'friend',
        consentState: 'allowed',
      },
      {
        id: 'carl-entity',
        type: 'pet',
        displayName: 'Carl',
        relationship: 'dog',
        consentState: 'allowed',
      },
    ],
  });

  const martin = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/martin.jpg',
    stableTag: 'protagonist_mart',
    targetType: 'protagonist',
    targetLabel: 'Martin',
    usagePermissions: 'allowed',
  });
  const dorian = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/dorian.jpg',
    stableTag: 'dorian',
    targetType: 'friend',
    targetLabel: 'Dorian',
    ownerEntityId: 'dorian-entity',
    usagePermissions: 'allowed',
  });
  const carl = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/carl.jpg',
    stableTag: 'carl',
    targetType: 'pet',
    targetLabel: 'Carl',
    ownerEntityId: 'carl-entity',
    usagePermissions: 'allowed',
  });

  proposeSceneOutline(db, 'session-1', {
    scenes: [
      {
        title: 'Festival arrival',
        summary: 'Martin arrives with Dorian while Carl reacts to the lights.',
        narratorText: 'The lights made everyone seem awake at once.',
        imagePrompt: 'Martin and his friend Dorian arrive at a trance festival while Carl watches the lights.',
        videoPrompt: 'The camera slowly follows them into the sea of lights.',
        duration: 7,
        referenceNeeds: [],
        referenceAssetIds: [],
        protagonistVisible: true,
      },
    ],
  });

  lockSceneOutlineForProduction(db, 'session-1');
  const scene = db.prepare('SELECT * FROM scenes WHERE session_id = ? AND title = ?').get('session-1', 'Festival arrival');

  assert.deepEqual(JSON.parse(scene.scene_references), [martin.id, dorian.id, carl.id]);
  assert.deepEqual(JSON.parse(scene.reference_tags), ['protagonist_mart', 'dorian', 'carl']);
});

test('locking an outline allows references owned by denied-consent entities while consent checks are disabled', () => {
  const db = createDb();
  addTreatment(db);
  const entityId = 'entity-denied-friend';

  applyProfileBucketUpdate(db, 'session-1', {
    entities: [
      {
        id: entityId,
        type: 'friend',
        displayName: 'Jordan',
        description: 'A childhood friend who appears in the memory.',
        consentState: 'denied',
      },
    ],
  });

  const friendReference = createReferenceAsset(db, 'session-1', {
    localUrl: '/uploads/jordan.jpg',
    stableTag: 'jordan',
    targetType: 'friend',
    targetLabel: 'Jordan',
    ownerEntityId: entityId,
    usagePermissions: 'allowed',
  });

  proposeSceneOutline(db, 'session-1', {
    scenes: [
      {
        title: 'The schoolyard promise',
        summary: 'Maya and Jordan stand near the fence after school.',
        narratorText: 'Jordan was there when Maya first admitted she wanted a different life.',
        imagePrompt: 'A cinematic schoolyard with @jordan near the fence in late light.',
        videoPrompt: 'The camera slowly tracks along the fence as Jordan turns toward Maya.',
        duration: 6,
        referenceNeeds: ['Jordan'],
        referenceAssetIds: [friendReference.id],
        protagonistVisible: false,
      },
    ],
  });

  const result = lockSceneOutlineForProduction(db, 'session-1');
  const scene = db.prepare('SELECT * FROM scenes WHERE session_id = ?').get('session-1');

  assert.equal(result.createdScenes, 1);
  assert.deepEqual(JSON.parse(scene.reference_tags), ['jordan']);
});

test('locking an outline allows description-only references while consent checks are disabled', () => {
  const db = createDb();
  addTreatment(db);

  const descriptionOnlyReference = createReferenceAsset(db, 'session-1', {
    localUrl: null,
    stableTag: 'dorian',
    targetType: 'protagonist',
    targetLabel: 'Dorian',
    usagePermissions: 'description_only',
  });

  proposeSceneOutline(db, 'session-1', {
    scenes: [
      {
        title: 'The juggling act',
        summary: 'Dorian balances study, code, and training.',
        narratorText: 'They say you cannot be two places at once.',
        imagePrompt: 'A cinematic montage with @dorian moving between study, code, and training.',
        videoPrompt: 'The camera quickly tracks through each part of the day with energetic motion.',
        duration: 6,
        referenceNeeds: ['Dorian'],
        referenceAssetIds: [descriptionOnlyReference.id],
        protagonistVisible: true,
      },
    ],
  });

  const result = lockSceneOutlineForProduction(db, 'session-1');
  const scene = db.prepare('SELECT * FROM scenes WHERE session_id = ?').get('session-1');

  assert.equal(result.createdScenes, 1);
  assert.deepEqual(JSON.parse(scene.reference_tags), ['dorian']);
});

test('locking an outline can re-enable consent checks with the environment flag', () => {
  const previousValue = process.env.LIFESTORY_CONSENT_CHECKS_ENABLED;
  process.env.LIFESTORY_CONSENT_CHECKS_ENABLED = 'true';

  try {
    const db = createDb();
    addTreatment(db);

    const descriptionOnlyReference = createReferenceAsset(db, 'session-1', {
      localUrl: null,
      stableTag: 'dorian',
      targetType: 'protagonist',
      targetLabel: 'Dorian',
      usagePermissions: 'description_only',
    });

    proposeSceneOutline(db, 'session-1', {
      scenes: [
        {
          title: 'The juggling act',
          summary: 'Dorian balances study, code, and training.',
          narratorText: 'They say you cannot be two places at once.',
          imagePrompt: 'A cinematic montage with @dorian moving between study, code, and training.',
          videoPrompt: 'The camera quickly tracks through each part of the day with energetic motion.',
          duration: 6,
          referenceNeeds: ['Dorian'],
          referenceAssetIds: [descriptionOnlyReference.id],
          protagonistVisible: true,
        },
      ],
    });

    assert.throws(
      () => lockSceneOutlineForProduction(db, 'session-1'),
      /consent checks failed/,
    );
  } finally {
    if (previousValue === undefined) {
      delete process.env.LIFESTORY_CONSENT_CHECKS_ENABLED;
    } else {
      process.env.LIFESTORY_CONSENT_CHECKS_ENABLED = previousValue;
    }
  }
});
