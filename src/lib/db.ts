import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { initializeStoryBucketTables } from './story-bucket';
import { initializeMediaTaskTables } from './media-tasks';
import { seedReviewerAccount } from './auth/seed-reviewer';

type SqliteDatabase = Database.Database;

function columnExists(database: SqliteDatabase, tableName: string, columnName: string) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all()
    .some((column) => (column as { name: string }).name === columnName);
}

function addColumnIfMissing(database: SqliteDatabase, tableName: string, columnName: string, columnDefinition: string) {
  if (!columnExists(database, tableName, columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

function databasePath() {
  return process.env.LIFESTORY_DB_PATH || path.join(process.cwd(), 'data', 'lifestory.sqlite');
}

export function initializeDatabaseSchema(database: SqliteDatabase) {
  database.pragma('foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email_confirmed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'life_story',
      interview_medium TEXT NOT NULL DEFAULT 'text',
      status TEXT NOT NULL,
      story_text TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      clarify_question TEXT,
      user_name TEXT,
      user_age TEXT,
      user_selfie_url TEXT,
      final_video_url TEXT,
      user_id TEXT,
      final_video_media_asset_id TEXT,
      render_notification_email TEXT,
      render_notification_sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME,
      revoked_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_api_credentials (
      user_id TEXT PRIMARY KEY,
      openrouter_key_encrypted TEXT,
      openrouter_key_iv TEXT,
      openrouter_key_tag TEXT,
      runway_key_encrypted TEXT,
      runway_key_iv TEXT,
      runway_key_tag TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      runway_concurrency_mode TEXT NOT NULL DEFAULT 'serial',
      runway_video_model TEXT NOT NULL DEFAULT 'gen4_turbo',
      final_render_backend TEXT NOT NULL DEFAULT 'local',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT,
      scene_index INTEGER NOT NULL,
      narrator_text TEXT NOT NULL,
      visual_prompt TEXT NOT NULL,
      image_prompt TEXT,
      video_prompt TEXT,
      duration REAL,
      scene_references TEXT,
      reference_image_url TEXT,
      video_url TEXT,
      audio_url TEXT,
      status TEXT DEFAULT 'pending',
      is_protagonist_visible BOOLEAN DEFAULT 1,
      reference_tags TEXT,
      shot_plan_json TEXT,
      retry_attempts INTEGER DEFAULT 0,
      last_failure TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS user_uploads (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      vision_description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      options TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER,
      original_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS avatar_call_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      runway_session_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      transcript_json TEXT,
      error_message TEXT,
      started_at DATETIME,
      ended_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS avatar_call_events (
      id TEXT PRIMARY KEY,
      avatar_call_session_id TEXT,
      session_id TEXT NOT NULL,
      runway_session_id TEXT,
      event_type TEXT NOT NULL,
      tool_name TEXT,
      duration_ms INTEGER,
      payload_json TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (avatar_call_session_id) REFERENCES avatar_call_sessions(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);

  addColumnIfMissing(database, 'sessions', 'mode', "mode TEXT DEFAULT 'life_story'");
  addColumnIfMissing(database, 'sessions', 'interview_medium', "interview_medium TEXT NOT NULL DEFAULT 'text'");
  addColumnIfMissing(database, 'sessions', 'user_name', 'user_name TEXT');
  addColumnIfMissing(database, 'sessions', 'user_age', 'user_age TEXT');
  addColumnIfMissing(database, 'sessions', 'user_selfie_url', 'user_selfie_url TEXT');
  addColumnIfMissing(database, 'sessions', 'final_video_url', 'final_video_url TEXT');
  addColumnIfMissing(database, 'sessions', 'user_id', 'user_id TEXT');
  addColumnIfMissing(database, 'sessions', 'final_video_media_asset_id', 'final_video_media_asset_id TEXT');
  addColumnIfMissing(database, 'sessions', 'render_notification_email', 'render_notification_email TEXT');
  addColumnIfMissing(database, 'sessions', 'render_notification_sent_at', 'render_notification_sent_at DATETIME');

  addColumnIfMissing(database, 'scenes', 'image_prompt', 'image_prompt TEXT');
  addColumnIfMissing(database, 'scenes', 'video_prompt', 'video_prompt TEXT');
  addColumnIfMissing(database, 'scenes', 'duration', 'duration REAL');
  addColumnIfMissing(database, 'scenes', 'scene_references', 'scene_references TEXT');
  addColumnIfMissing(database, 'scenes', 'is_protagonist_visible', 'is_protagonist_visible BOOLEAN DEFAULT 1');
  addColumnIfMissing(database, 'scenes', 'title', 'title TEXT');
  addColumnIfMissing(database, 'scenes', 'reference_tags', 'reference_tags TEXT');
  addColumnIfMissing(database, 'scenes', 'shot_plan_json', 'shot_plan_json TEXT');
  addColumnIfMissing(database, 'scenes', 'retry_attempts', 'retry_attempts INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'scenes', 'last_failure', 'last_failure TEXT');

  addColumnIfMissing(database, 'chat_history', 'options', 'options TEXT');
  addColumnIfMissing(database, 'user_uploads', 'vision_description', 'vision_description TEXT');
  addColumnIfMissing(database, 'user_settings', 'runway_video_model', "runway_video_model TEXT NOT NULL DEFAULT 'gen4_turbo'");
  addColumnIfMissing(database, 'user_settings', 'final_render_backend', "final_render_backend TEXT NOT NULL DEFAULT 'local'");

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_media_assets_owner ON media_assets(user_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_avatar_call_sessions_session ON avatar_call_sessions(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_avatar_call_events_session ON avatar_call_events(session_id, created_at);
  `);

  initializeStoryBucketTables(database);
  initializeMediaTaskTables(database);
}

const dbPath = databasePath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
initializeDatabaseSchema(db);
seedReviewerAccount(db);

export default db;
