export type AspectRatio = '16:9' | '9:16';

export type SessionMode = 'single_memory' | 'life_story';

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
  created_at: string;
  updated_at: string;
}

export interface SceneRow {
  id: string;
  session_id: string;
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

export type StoryBucket = {
  profile: StoryProfileRow | null;
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

export type SessionUpdatePayload = {
  session?: SessionRow;
  status?: SessionStatus;
  chat_history?: ChatHistoryRow[];
  scenes?: SceneRow[];
  story_bucket?: StoryBucket;
  active_reference_request?: ReferenceUploadRequestRow | null;
  chat_chunk?: { id: string, text: string };
  error?: string;
};
