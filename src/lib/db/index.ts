import Database from 'better-sqlite3';
import path from 'path';

// Store DB in the persistent data volume when deployed
const dbPath = process.env.NODE_ENV === 'production' 
  ? path.join(process.cwd(), 'data', 'lifestory.db')
  : path.join(process.cwd(), 'lifestory.db');

export const db = new Database(dbPath);

// Initialize schema
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    story TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'ingesting'
  );

  CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    scene_number INTEGER,
    narrator_text TEXT,
    visual_prompt TEXT,
    reference_image_url TEXT,
    video_url TEXT,
    audio_url TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    file_path TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
`);

export interface Session {
  id: string;
  story: string;
  status: 'ingesting' | 'structuring' | 'upload_checkpoint' | 'generating_references' | 'generating_media' | 'completed';
}

export interface Scene {
  id: string;
  session_id: string;
  scene_number: number;
  narrator_text: string;
  visual_prompt: string;
  reference_image_url: string | null;
  video_url: string | null;
  audio_url: string | null;
}
