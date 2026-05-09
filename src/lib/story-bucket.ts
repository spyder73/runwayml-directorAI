import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  MemoryCandidateRow,
  ReferenceAssetRow,
  ReferenceUploadRequestRow,
  SceneOutlineRow,
  StoryBucket,
  StoryEntityRow,
  StoryProfileRow,
} from './types';

type SqliteDatabase = Database.Database;

type ProfileUpdate = {
  protagonistName?: string;
  age?: string;
  pronouns?: string;
  lifePhase?: string;
  emotionalTone?: string;
  visualDescription?: string;
  protagonistReferenceAssetId?: string;
  summary?: string;
  themes?: string[];
};

type EntityUpdate = {
  id?: string;
  type: string;
  displayName: string;
  description?: string;
  relationship?: string;
  consentState?: string;
  referenceAssetId?: string;
};

type MemoryCandidateUpdate = {
  id?: string;
  title: string;
  description: string;
  emotionalPurpose?: string;
  visualSummary?: string;
  people?: string[];
  places?: string[];
  referencesNeeded?: string[];
  status?: string;
};

type TimelineEventUpdate = {
  label: string;
  description: string;
  era?: string;
  emotion?: string;
};

export type ProfileBucketUpdate = {
  profile?: ProfileUpdate;
  entities?: EntityUpdate[];
  memoryCandidates?: MemoryCandidateUpdate[];
  timelineEvents?: TimelineEventUpdate[];
  themes?: string[];
};

export type ReferenceAssetInput = {
  localUrl?: string | null;
  runwayUri?: string | null;
  stableTag?: string;
  visionDescription?: string | null;
  ownerEntityId?: string | null;
  targetType: string;
  targetLabel?: string;
  usagePermissions?: string;
  source?: string;
};

export type ReferenceUploadRequestInput = {
  targetType: string;
  targetLabel: string;
  promptText: string;
  reason?: string;
  fallbackPrompt?: string;
  entityId?: string;
};

export type SceneOutlineInput = {
  scenes: Array<{
    id?: string;
    title: string;
    summary: string;
    narratorText: string;
    imagePrompt: string;
    videoPrompt: string;
    duration: number;
    emotionalPurpose?: string;
    referenceNeeds?: string[];
    referenceAssetIds?: string[];
    protagonistVisible?: boolean;
  }>;
};

export type SceneOutlineRevisionInput = {
  comment?: string;
  sceneOutlineId?: string;
  sceneIndex?: number;
  updates?: {
    title?: string;
    summary?: string;
    narratorText?: string;
    imagePrompt?: string;
    videoPrompt?: string;
    duration?: number;
    emotionalPurpose?: string;
    referenceNeeds?: string[];
    referenceAssetIds?: string[];
    protagonistVisible?: boolean;
  };
};

function jsonArray(value: unknown) {
  if (!Array.isArray(value)) return JSON.stringify([]);
  return JSON.stringify(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()));
}

function parseArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function mergeStringArrays(...values: Array<string[] | undefined>) {
  const seen = new Set<string>();
  for (const list of values) {
    for (const item of list || []) {
      const trimmed = item.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen];
}

function nullable(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function boolToInt(value: boolean | undefined, fallback = true) {
  return value ?? fallback ? 1 : 0;
}

function normalizeTagPart(value: string | undefined | null) {
  const normalized = (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (!normalized) return 'reference';
  if (/^[a-z]/.test(normalized)) return normalized;
  return `ref_${normalized}`;
}

function uniqueStableTag(database: SqliteDatabase, sessionId: string, preferred: string) {
  const base = normalizeTagPart(preferred);
  let tag = base;
  let suffix = 2;

  const exists = database.prepare('SELECT 1 FROM reference_assets WHERE session_id = ? AND stable_tag = ? LIMIT 1');
  while (exists.get(sessionId, tag)) {
    tag = `${base}_${suffix}`;
    suffix += 1;
  }

  return tag;
}

export function initializeStoryBucketTables(database: SqliteDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS story_profile (
      session_id TEXT PRIMARY KEY,
      protagonist_name TEXT,
      age TEXT,
      pronouns TEXT,
      life_phase TEXT,
      emotional_tone TEXT,
      visual_description TEXT,
      protagonist_reference_asset_id TEXT,
      summary TEXT,
      themes_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS story_entities (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      relationship TEXT,
      consent_state TEXT NOT NULL DEFAULT 'unknown',
      reference_asset_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS story_timeline_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      era TEXT,
      emotion TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS reference_assets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      local_url TEXT,
      runway_uri TEXT,
      stable_tag TEXT NOT NULL,
      vision_description TEXT,
      owner_entity_id TEXT,
      target_type TEXT NOT NULL,
      usage_permissions TEXT NOT NULL DEFAULT 'allowed',
      source TEXT NOT NULL DEFAULT 'upload',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      UNIQUE(session_id, stable_tag)
    );

    CREATE TABLE IF NOT EXISTS reference_upload_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_label TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      reason TEXT,
      fallback_prompt TEXT NOT NULL,
      entity_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS memory_candidates (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      emotional_purpose TEXT,
      visual_summary TEXT,
      people_json TEXT,
      places_json TEXT,
      references_needed_json TEXT,
      sketch_url TEXT,
      sketch_prompt TEXT,
      sketch_feedback TEXT,
      status TEXT NOT NULL DEFAULT 'candidate',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS scene_outline (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      scene_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      narrator_text TEXT NOT NULL,
      image_prompt TEXT NOT NULL,
      video_prompt TEXT NOT NULL,
      duration INTEGER NOT NULL,
      emotional_purpose TEXT,
      reference_needs_json TEXT,
      reference_asset_ids_json TEXT,
      protagonist_visible BOOLEAN DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      locked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS scene_outline_comments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      scene_outline_id TEXT NOT NULL,
      comment TEXT NOT NULL,
      resolved BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (scene_outline_id) REFERENCES scene_outline(id)
    );
  `);
}

export function loadStoryBucket(database: SqliteDatabase, sessionId: string): StoryBucket {
  return {
    profile: database.prepare('SELECT * FROM story_profile WHERE session_id = ?').get(sessionId) as StoryProfileRow | null,
    entities: database.prepare('SELECT * FROM story_entities WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as StoryEntityRow[],
    referenceAssets: database.prepare('SELECT * FROM reference_assets WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ReferenceAssetRow[],
    memoryCandidates: database.prepare('SELECT * FROM memory_candidates WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as MemoryCandidateRow[],
    sceneOutline: database.prepare('SELECT * FROM scene_outline WHERE session_id = ? ORDER BY scene_index ASC').all(sessionId) as SceneOutlineRow[],
    sceneOutlineComments: database.prepare('SELECT * FROM scene_outline_comments WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as StoryBucket['sceneOutlineComments'],
    uploadRequests: database.prepare('SELECT * FROM reference_upload_requests WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ReferenceUploadRequestRow[],
    timelineEvents: database.prepare('SELECT * FROM story_timeline_events WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as StoryBucket['timelineEvents'],
  };
}

export function getActiveReferenceRequest(database: SqliteDatabase, sessionId: string) {
  return database.prepare(`
    SELECT * FROM reference_upload_requests
    WHERE session_id = ? AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId) as ReferenceUploadRequestRow | undefined;
}

export function hasProtagonistReferenceDecision(database: SqliteDatabase, sessionId: string) {
  const session = database.prepare('SELECT user_selfie_url FROM sessions WHERE id = ?').get(sessionId) as { user_selfie_url?: string | null } | undefined;
  if (session?.user_selfie_url) return true;

  const asset = database.prepare(`
    SELECT 1 FROM reference_assets
    WHERE session_id = ? AND target_type = 'protagonist'
    LIMIT 1
  `).get(sessionId);
  if (asset) return true;

  const request = database.prepare(`
    SELECT 1 FROM reference_upload_requests
    WHERE session_id = ? AND target_type = 'protagonist'
    LIMIT 1
  `).get(sessionId);

  return Boolean(request);
}

export function applyProfileBucketUpdate(database: SqliteDatabase, sessionId: string, input: ProfileBucketUpdate) {
  const current = database.prepare('SELECT * FROM story_profile WHERE session_id = ?').get(sessionId) as StoryProfileRow | undefined;
  const profile = input.profile || {};
  const mergedThemes = mergeStringArrays(parseArray(current?.themes_json), profile.themes, input.themes);

  database.prepare(`
    INSERT INTO story_profile (
      session_id, protagonist_name, age, pronouns, life_phase, emotional_tone, visual_description,
      protagonist_reference_asset_id, summary, themes_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id) DO UPDATE SET
      protagonist_name = COALESCE(excluded.protagonist_name, story_profile.protagonist_name),
      age = COALESCE(excluded.age, story_profile.age),
      pronouns = COALESCE(excluded.pronouns, story_profile.pronouns),
      life_phase = COALESCE(excluded.life_phase, story_profile.life_phase),
      emotional_tone = COALESCE(excluded.emotional_tone, story_profile.emotional_tone),
      visual_description = COALESCE(excluded.visual_description, story_profile.visual_description),
      protagonist_reference_asset_id = COALESCE(excluded.protagonist_reference_asset_id, story_profile.protagonist_reference_asset_id),
      summary = COALESCE(excluded.summary, story_profile.summary),
      themes_json = excluded.themes_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    sessionId,
    nullable(profile.protagonistName),
    nullable(profile.age),
    nullable(profile.pronouns),
    nullable(profile.lifePhase),
    nullable(profile.emotionalTone),
    nullable(profile.visualDescription),
    nullable(profile.protagonistReferenceAssetId),
    nullable(profile.summary),
    jsonArray(mergedThemes),
  );

  if (profile.protagonistName || profile.age) {
    database.prepare(`
      UPDATE sessions
      SET user_name = COALESCE(?, user_name),
          user_age = COALESCE(?, user_age),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nullable(profile.protagonistName), nullable(profile.age), sessionId);
  }

  const insertEntity = database.prepare(`
    INSERT INTO story_entities (
      id, session_id, type, display_name, description, relationship, consent_state, reference_asset_id, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      display_name = excluded.display_name,
      description = COALESCE(excluded.description, story_entities.description),
      relationship = COALESCE(excluded.relationship, story_entities.relationship),
      consent_state = excluded.consent_state,
      reference_asset_id = COALESCE(excluded.reference_asset_id, story_entities.reference_asset_id),
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const entity of input.entities || []) {
    insertEntity.run(
      entity.id || uuidv4(),
      sessionId,
      entity.type,
      entity.displayName,
      nullable(entity.description),
      nullable(entity.relationship),
      entity.consentState || 'unknown',
      nullable(entity.referenceAssetId),
    );
  }

  const insertTimeline = database.prepare(`
    INSERT INTO story_timeline_events (id, session_id, label, description, era, emotion)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const event of input.timelineEvents || []) {
    insertTimeline.run(uuidv4(), sessionId, event.label, event.description, nullable(event.era), nullable(event.emotion));
  }

  const insertCandidate = database.prepare(`
    INSERT INTO memory_candidates (
      id, session_id, title, description, emotional_purpose, visual_summary, people_json,
      places_json, references_needed_json, status, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      emotional_purpose = COALESCE(excluded.emotional_purpose, memory_candidates.emotional_purpose),
      visual_summary = COALESCE(excluded.visual_summary, memory_candidates.visual_summary),
      people_json = excluded.people_json,
      places_json = excluded.places_json,
      references_needed_json = excluded.references_needed_json,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const candidate of input.memoryCandidates || []) {
    insertCandidate.run(
      candidate.id || uuidv4(),
      sessionId,
      candidate.title,
      candidate.description,
      nullable(candidate.emotionalPurpose),
      nullable(candidate.visualSummary),
      jsonArray(candidate.people || []),
      jsonArray(candidate.places || []),
      jsonArray(candidate.referencesNeeded || []),
      candidate.status || 'candidate',
    );
  }

  return loadStoryBucket(database, sessionId);
}

export function createReferenceUploadRequest(
  database: SqliteDatabase,
  sessionId: string,
  input: ReferenceUploadRequestInput,
  options: { updateSessionStatus?: boolean } = {},
) {
  const id = uuidv4();
  const fallbackPrompt = input.fallbackPrompt || `No problem if you would rather not upload it. Could you describe ${input.targetLabel} visually instead?`;

  database.prepare(`
    UPDATE reference_upload_requests
    SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
    WHERE session_id = ? AND status = 'pending'
  `).run(sessionId);

  database.prepare(`
    INSERT INTO reference_upload_requests (
      id, session_id, target_type, target_label, prompt_text, reason, fallback_prompt, entity_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    sessionId,
    input.targetType,
    input.targetLabel,
    input.promptText,
    nullable(input.reason),
    fallbackPrompt,
    nullable(input.entityId),
  );

  if (options.updateSessionStatus !== false) {
    database.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(input.targetType === 'protagonist' ? 'AWAITING_SELFIE' : 'AWAITING_REFERENCE', sessionId);
  }

  return database.prepare('SELECT * FROM reference_upload_requests WHERE id = ?').get(id) as ReferenceUploadRequestRow;
}

export function markActiveReferenceRequest(
  database: SqliteDatabase,
  sessionId: string,
  status: 'fulfilled' | 'skipped' | 'described',
) {
  const request = getActiveReferenceRequest(database, sessionId);
  if (!request) return undefined;

  database.prepare('UPDATE reference_upload_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(status, request.id);

  return { ...request, status };
}

export function createReferenceAsset(database: SqliteDatabase, sessionId: string, input: ReferenceAssetInput) {
  const request = getActiveReferenceRequest(database, sessionId);
  const targetType = input.targetType || request?.target_type || 'reference';
  const targetLabel = input.targetLabel || request?.target_label || targetType;
  const stableTag = input.stableTag || uniqueStableTag(database, sessionId, `${targetType}_${targetLabel}`);
  const id = uuidv4();

  database.prepare(`
    INSERT INTO reference_assets (
      id, session_id, local_url, runway_uri, stable_tag, vision_description, owner_entity_id,
      target_type, usage_permissions, source, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    sessionId,
    input.localUrl || null,
    input.runwayUri || null,
    stableTag,
    input.visionDescription || null,
    input.ownerEntityId || request?.entity_id || null,
    targetType,
    input.usagePermissions || 'allowed',
    input.source || 'upload',
  );

  if (request) {
    database.prepare('UPDATE reference_upload_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(input.localUrl ? 'fulfilled' : 'described', request.id);
  }

  if (targetType === 'protagonist') {
    database.prepare(`
      INSERT INTO story_profile (session_id, protagonist_reference_asset_id, themes_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET
        protagonist_reference_asset_id = excluded.protagonist_reference_asset_id,
        updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, id, jsonArray([]));
  }

  return database.prepare('SELECT * FROM reference_assets WHERE id = ?').get(id) as ReferenceAssetRow;
}

export function saveReferenceDescription(
  database: SqliteDatabase,
  sessionId: string,
  input: { targetType: string; targetLabel: string; description: string; usagePermissions?: string },
) {
  return createReferenceAsset(database, sessionId, {
    targetType: input.targetType,
    targetLabel: input.targetLabel,
    visionDescription: input.description,
    usagePermissions: input.usagePermissions || 'description_only',
    source: 'description',
  });
}

export function recordMemorySketch(
  database: SqliteDatabase,
  sessionId: string,
  input: {
    candidateId?: string;
    title: string;
    description: string;
    visualPrompt: string;
    sketchUrl?: string | null;
  },
) {
  const id = input.candidateId || uuidv4();
  database.prepare(`
    INSERT INTO memory_candidates (
      id, session_id, title, description, visual_summary, sketch_url, sketch_prompt, status, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'sketched', CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      visual_summary = excluded.visual_summary,
      sketch_url = COALESCE(excluded.sketch_url, memory_candidates.sketch_url),
      sketch_prompt = excluded.sketch_prompt,
      status = 'sketched',
      updated_at = CURRENT_TIMESTAMP
  `).run(id, sessionId, input.title, input.description, input.visualPrompt, input.sketchUrl || null, input.visualPrompt);

  return database.prepare('SELECT * FROM memory_candidates WHERE id = ?').get(id) as MemoryCandidateRow;
}

export function saveSketchFeedback(
  database: SqliteDatabase,
  sessionId: string,
  input: { candidateId: string; feedback: 'accepted' | 'rejected' | 'revised'; note?: string },
) {
  database.prepare(`
    UPDATE memory_candidates
    SET sketch_feedback = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND session_id = ?
  `).run(input.note ? `${input.feedback}: ${input.note}` : input.feedback, input.feedback, input.candidateId, sessionId);

  return database.prepare('SELECT * FROM memory_candidates WHERE id = ? AND session_id = ?')
    .get(input.candidateId, sessionId) as MemoryCandidateRow | undefined;
}

export function proposeSceneOutline(database: SqliteDatabase, sessionId: string, input: SceneOutlineInput) {
  const insertOutline = database.prepare(`
    INSERT INTO scene_outline (
      id, session_id, scene_index, title, summary, narrator_text, image_prompt, video_prompt,
      duration, emotional_purpose, reference_needs_json, reference_asset_ids_json, protagonist_visible,
      status, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', CURRENT_TIMESTAMP)
  `);

  const trx = database.transaction(() => {
    database.prepare("DELETE FROM scene_outline_comments WHERE session_id = ? AND scene_outline_id IN (SELECT id FROM scene_outline WHERE session_id = ? AND status != 'locked')")
      .run(sessionId, sessionId);
    database.prepare("DELETE FROM scene_outline WHERE session_id = ? AND status != 'locked'").run(sessionId);

    input.scenes.forEach((scene, index) => {
      insertOutline.run(
        scene.id || uuidv4(),
        sessionId,
        index,
        scene.title,
        scene.summary,
        scene.narratorText,
        scene.imagePrompt,
        scene.videoPrompt,
        Math.max(2, Math.min(10, Math.round(scene.duration || 5))),
        nullable(scene.emotionalPurpose),
        jsonArray(scene.referenceNeeds || []),
        jsonArray(scene.referenceAssetIds || []),
        boolToInt(scene.protagonistVisible),
      );
    });

    database.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('OUTLINE_REVIEW', sessionId);
  });

  trx();
  return loadStoryBucket(database, sessionId).sceneOutline;
}

export function reviseSceneOutline(database: SqliteDatabase, sessionId: string, input: SceneOutlineRevisionInput) {
  const scene = input.sceneOutlineId
    ? database.prepare('SELECT * FROM scene_outline WHERE id = ? AND session_id = ?').get(input.sceneOutlineId, sessionId) as SceneOutlineRow | undefined
    : database.prepare('SELECT * FROM scene_outline WHERE scene_index = ? AND session_id = ?').get(input.sceneIndex ?? -1, sessionId) as SceneOutlineRow | undefined;

  if (!scene) return undefined;

  if (input.comment) {
    database.prepare(`
      INSERT INTO scene_outline_comments (id, session_id, scene_outline_id, comment)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), sessionId, scene.id, input.comment);
  }

  if (input.updates) {
    const updates = input.updates;
    database.prepare(`
      UPDATE scene_outline
      SET title = COALESCE(?, title),
          summary = COALESCE(?, summary),
          narrator_text = COALESCE(?, narrator_text),
          image_prompt = COALESCE(?, image_prompt),
          video_prompt = COALESCE(?, video_prompt),
          duration = COALESCE(?, duration),
          emotional_purpose = COALESCE(?, emotional_purpose),
          reference_needs_json = COALESCE(?, reference_needs_json),
          reference_asset_ids_json = COALESCE(?, reference_asset_ids_json),
          protagonist_visible = COALESCE(?, protagonist_visible),
          status = 'revised',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND session_id = ?
    `).run(
      nullable(updates.title),
      nullable(updates.summary),
      nullable(updates.narratorText),
      nullable(updates.imagePrompt),
      nullable(updates.videoPrompt),
      updates.duration ? Math.max(2, Math.min(10, Math.round(updates.duration))) : null,
      nullable(updates.emotionalPurpose),
      updates.referenceNeeds ? jsonArray(updates.referenceNeeds) : null,
      updates.referenceAssetIds ? jsonArray(updates.referenceAssetIds) : null,
      typeof updates.protagonistVisible === 'boolean' ? boolToInt(updates.protagonistVisible) : null,
      scene.id,
      sessionId,
    );
  }

  return database.prepare('SELECT * FROM scene_outline WHERE id = ?').get(scene.id) as SceneOutlineRow;
}

export function lockSceneOutlineForProduction(database: SqliteDatabase, sessionId: string) {
  const outlineRows = database.prepare('SELECT * FROM scene_outline WHERE session_id = ? ORDER BY scene_index ASC')
    .all(sessionId) as SceneOutlineRow[];

  if (!outlineRows.length) {
    throw new Error('Scene outline must be proposed before production can start.');
  }

  const insertScene = database.prepare(`
    INSERT INTO scenes (
      id, session_id, scene_index, narrator_text, visual_prompt, video_prompt, image_prompt,
      duration, scene_references, is_protagonist_visible, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  const trx = database.transaction(() => {
    database.prepare('DELETE FROM scenes WHERE session_id = ?').run(sessionId);

    outlineRows.forEach((row, index) => {
      insertScene.run(
        uuidv4(),
        sessionId,
        index,
        row.narrator_text,
        row.video_prompt,
        row.video_prompt,
        row.image_prompt,
        row.duration,
        row.reference_needs_json || row.reference_asset_ids_json || '[]',
        row.protagonist_visible ? 1 : 0,
      );
    });

    database.prepare(`
      UPDATE scene_outline
      SET status = 'locked', locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ?
    `).run(sessionId);

    database.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('GENERATING_IMAGES', sessionId);
  });

  trx();
  return { createdScenes: outlineRows.length };
}
