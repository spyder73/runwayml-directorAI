export type AspectRatio = '16:9' | '9:16';

export type SessionMode = 'life_story';

export type SessionStatus =
  | 'INTERVIEW_ONBOARDING'
  | 'INTERVIEW_PSYCH_PROFILE'
  | 'INTERVIEW_DYNAMIC'
  | 'PRE_PRODUCTION'
  | 'AWAITING_SELFIE'
  | 'AWAITING_REFERENCE'
  | 'OUTLINE_REVIEW'
  | 'GENERATING_IMAGES'
  | 'AWAITING_APPROVAL'
  | 'GENERATING_FINAL_ASSETS'
  | 'PREVIEW_READY'
  | 'RENDERING'
  | 'COMPLETED'
  | 'FAILED';

export interface SessionRow {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  story_text: string;
  aspect_ratio: AspectRatio;
  clarify_question: string | null;
  user_name: string | null;
  user_age: string | null;
  user_selfie_url: string | null;
  final_video_url: string | null;
  user_id: string | null;
  final_video_media_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  email_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface EmailVerificationTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface UserApiCredentialsRow {
  user_id: string;
  openrouter_key_encrypted: string | null;
  openrouter_key_iv: string | null;
  openrouter_key_tag: string | null;
  runway_key_encrypted: string | null;
  runway_key_iv: string | null;
  runway_key_tag: string | null;
  updated_at: string;
}

export type RunwayConcurrencyMode = 'serial' | 'parallel';

export interface UserSettingsRow {
  user_id: string;
  runway_concurrency_mode: RunwayConcurrencyMode;
  created_at: string;
  updated_at: string;
}

export interface MediaAssetRow {
  id: string;
  user_id: string;
  session_id: string;
  kind: string;
  file_path: string;
  mime_type: string;
  byte_size: number | null;
  original_name: string | null;
  created_at: string;
}

export interface SceneRow {
  id: string;
  session_id: string;
  title: string | null;
  scene_index: number;
  narrator_text: string;
  visual_prompt: string;
  image_prompt: string | null;
  video_prompt: string | null;
  duration: number | null;
  scene_references: string | null;
  reference_image_url: string | null;
  video_url: string | null;
  audio_url: string | null;
  status: string;
  is_protagonist_visible: boolean | number;
  reference_tags: string | null;
  shot_plan_json: string | null;
  retry_attempts: number | null;
  last_failure: string | null;
}

export interface ChatHistoryRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  options: string | null;
  created_at: string;
}

export interface UserUploadRow {
  id: string;
  session_id: string;
  file_path: string;
  vision_description: string | null;
  created_at: string;
}

export interface StoryProfileRow {
  session_id: string;
  protagonist_name: string | null;
  age: string | null;
  profession: string | null;
  current_location: string | null;
  pronouns: string | null;
  life_phase: string | null;
  emotional_tone: string | null;
  visual_description: string | null;
  protagonist_reference_asset_id: string | null;
  summary: string | null;
  themes_json: string | null;
  updated_at: string;
}

export interface StoryEntityRow {
  id: string;
  session_id: string;
  type: string;
  display_name: string;
  description: string | null;
  relationship: string | null;
  consent_state: string;
  reference_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferenceAssetRow {
  id: string;
  session_id: string;
  local_url: string | null;
  runway_uri: string | null;
  stable_tag: string;
  vision_description: string | null;
  owner_entity_id: string | null;
  target_type: string;
  usage_permissions: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryCandidateRow {
  id: string;
  session_id: string;
  title: string;
  description: string;
  emotional_purpose: string | null;
  visual_summary: string | null;
  people_json: string | null;
  places_json: string | null;
  references_needed_json: string | null;
  sketch_url: string | null;
  sketch_prompt: string | null;
  sketch_feedback: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SceneOutlineRow {
  id: string;
  session_id: string;
  scene_index: number;
  title: string;
  summary: string;
  narrator_text: string;
  image_prompt: string;
  video_prompt: string;
  duration: number;
  emotional_purpose: string | null;
  reference_needs_json: string | null;
  reference_asset_ids_json: string | null;
  protagonist_visible: boolean | number;
  status: string;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SceneOutlineCommentRow {
  id: string;
  session_id: string;
  scene_outline_id: string;
  comment: string;
  resolved: boolean | number;
  created_at: string;
}

export interface ReferenceUploadRequestRow {
  id: string;
  session_id: string;
  target_type: string;
  target_label: string;
  prompt_text: string;
  reason: string | null;
  fallback_prompt: string;
  entity_id: string | null;
  reference_scope: string | null;
  scene_title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface StoryTimelineEventRow {
  id: string;
  session_id: string;
  label: string;
  description: string;
  era: string | null;
  emotion: string | null;
  created_at: string;
}

export interface StoryTreatmentRow {
  id: string;
  session_id: string;
  title: string;
  emotional_thesis: string;
  narrative_arc: string;
  visual_motif: string;
  narrator_style: string;
  ending_feeling: string;
  avoid_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export type StoryBucket = {
  profile: StoryProfileRow | null;
  treatment: StoryTreatmentRow | null;
  entities: StoryEntityRow[];
  referenceAssets: ReferenceAssetRow[];
  memoryCandidates: MemoryCandidateRow[];
  sceneOutline: SceneOutlineRow[];
  sceneOutlineComments: SceneOutlineCommentRow[];
  uploadRequests: ReferenceUploadRequestRow[];
  timelineEvents: StoryTimelineEventRow[];
};

export type InterviewMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type RenderProgressPayload = {
  progress: number;
  message: string;
  renderedFrames: number | null;
  encodedFrames: number | null;
  totalFrames: number | null;
  stitchStage: string | null;
  updatedAt: string | null;
};

export type SessionUpdatePayload = {
  session?: SessionRow;
  status?: SessionStatus;
  chat_history?: ChatHistoryRow[];
  scenes?: SceneRow[];
  story_bucket?: StoryBucket;
  active_reference_request?: ReferenceUploadRequestRow | null;
  render_progress?: RenderProgressPayload | null;
  chat_chunk?: { id: string, text: string };
  error?: string;
};
