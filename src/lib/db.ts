import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { initializeStoryBucketTables } from './story-bucket';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'lifestory.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'life_story',
    status TEXT NOT NULL,
    story_text TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    clarify_question TEXT,
    user_name TEXT,
    user_age TEXT,
    user_selfie_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
// Ignore errors from ALTER TABLE if columns already exist.
try { db.exec("ALTER TABLE sessions ADD COLUMN user_name TEXT"); } catch {}
try { db.exec("ALTER TABLE sessions ADD COLUMN user_age TEXT"); } catch {}
try { db.exec("ALTER TABLE sessions ADD COLUMN user_selfie_url TEXT"); } catch {}
try { db.exec("ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'life_story'"); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS scenes (
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
    is_protagonist_visible BOOLEAN DEFAULT 1,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
`);
try { db.exec("ALTER TABLE scenes ADD COLUMN image_prompt TEXT"); } catch {}
try { db.exec("ALTER TABLE scenes ADD COLUMN video_prompt TEXT"); } catch {}
try { db.exec("ALTER TABLE scenes ADD COLUMN duration INTEGER"); } catch {}
try { db.exec("ALTER TABLE scenes ADD COLUMN scene_references TEXT"); } catch {}
try { db.exec("ALTER TABLE scenes ADD COLUMN is_protagonist_visible BOOLEAN DEFAULT 1"); } catch {}

db.exec(`

  CREATE TABLE IF NOT EXISTS user_uploads (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
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
`);
try { db.exec("ALTER TABLE chat_history ADD COLUMN options TEXT"); } catch {}
try { db.exec("ALTER TABLE user_uploads ADD COLUMN vision_description TEXT"); } catch {}

initializeStoryBucketTables(db);

export default db;
