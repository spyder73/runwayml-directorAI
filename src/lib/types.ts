export type AspectRatio = '16:9' | '9:16';

export type SessionStatus =
  | 'INTERVIEW_ONBOARDING'
  | 'INTERVIEW_PSYCH_PROFILE'
  | 'INTERVIEW_DYNAMIC'
  | 'PRE_PRODUCTION'
  | 'AWAITING_SELFIE'
  | 'GENERATING_FINAL_ASSETS'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED';

export interface SessionRow {
  id: string;
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

export type InterviewMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type SessionUpdatePayload = {
  session?: SessionRow;
  status?: SessionStatus;
  chat_history?: ChatHistoryRow[];
  scenes?: SceneRow[];
  error?: string;
};
