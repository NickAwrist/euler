import type { Database } from "bun:sqlite";
import { POPULAR_PUBLISHERS } from "../models/openRouterPublishers";

const TABLES = `
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_uuid TEXT NOT NULL,
  model TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  input INTEGER,
  output INTEGER,
  cached INTEGER,
  cost REAL,
  savings REAL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  owner_uuid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT,
  model TEXT,
  session_directory TEXT,
  workspace_kind TEXT NOT NULL DEFAULT 'sandbox',
  last_activity_at INTEGER NOT NULL DEFAULT 0,
  last_viewed_at INTEGER NOT NULL DEFAULT 0,
  -- Ephemeral chats expire; saved chats have no expiry.
  expires_at INTEGER,
  linked_workspace_id TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  steps TEXT,
  position INTEGER NOT NULL,
  attachments TEXT,
  versions TEXT,
  activation_id TEXT
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  owner_uuid TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  owner_uuid TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  user_invocable INTEGER NOT NULL DEFAULT 1 CHECK (user_invocable IN (0, 1)),
  disable_model_invocation INTEGER NOT NULL DEFAULT 0 CHECK (disable_model_invocation IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_uuid, name)
);
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  owner_uuid TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  headers TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_uuid, name)
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_preferences (
  owner_uuid TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS openrouter_publishers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subscribed INTEGER NOT NULL DEFAULT 0 CHECK (subscribed IN (0, 1)),
  subscribed_at INTEGER,
  tracked INTEGER NOT NULL DEFAULT 1 CHECK (tracked IN (0, 1)),
  CHECK (subscribed = 0 OR subscribed_at IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS openrouter_models (
  route TEXT PRIMARY KEY,
  publisher_id TEXT NOT NULL REFERENCES openrouter_publishers(id),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  catalog_created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS model_favorites (
  owner_uuid TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openrouter', 'ollama', 'chatgpt')),
  model_id TEXT NOT NULL,
  PRIMARY KEY (owner_uuid, provider, model_id)
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  wakes INTEGER NOT NULL CHECK (wakes IN (0, 1)),
  held INTEGER NOT NULL DEFAULT 0 CHECK (held IN (0, 1)),
  attachment_ids TEXT NOT NULL DEFAULT '[]',
  attachments TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
-- One row per model message, so saving history writes only what changed.
CREATE TABLE IF NOT EXISTS agent_history (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  message TEXT NOT NULL,
  PRIMARY KEY (agent_id, position)
);
-- One row per trace step, so saving a step writes only that step.
CREATE TABLE IF NOT EXISTS agent_steps (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  activation_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  step TEXT NOT NULL,
  PRIMARY KEY (agent_id, activation_id, position)
);
-- The main agent's reply text since its last transcript segment.
CREATE TABLE IF NOT EXISTS agent_replies (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  owner_uuid TEXT NOT NULL,
  payload TEXT NOT NULL
);`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_usage_owner_time ON usage_events(owner_uuid, timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_session_position ON messages(session_id, position);
CREATE INDEX IF NOT EXISTS idx_attachments_owner_session ON attachments(owner_uuid, session_id);
CREATE INDEX IF NOT EXISTS idx_openrouter_models_publisher_enabled ON openrouter_models(publisher_id, enabled);
CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agent_messages_recipient ON agent_messages(agent_id, id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_waking
  ON agent_messages(held, wakes, agent_id, id) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_messages_undelivered
  ON agent_messages(agent_id, id) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(session_id, owner_uuid);`;

/** Creates any missing tables and offers the popular publishers once. */
export function createSchema(db: Database) {
  db.transaction(() => {
    db.run(TABLES);
    const favorites = db
      .query("SELECT sql FROM sqlite_master WHERE name = 'model_favorites'")
      .get() as { sql: string };
    if (!favorites.sql.includes("'chatgpt'")) {
      db.run(`ALTER TABLE model_favorites RENAME TO model_favorites_previous;
        CREATE TABLE model_favorites (
          owner_uuid TEXT NOT NULL,
          provider TEXT NOT NULL CHECK (provider IN ('openrouter', 'ollama', 'chatgpt')),
          model_id TEXT NOT NULL,
          PRIMARY KEY (owner_uuid, provider, model_id)
        );
        INSERT INTO model_favorites SELECT * FROM model_favorites_previous;
        DROP TABLE model_favorites_previous;`);
    }
    db.run(INDEXES);
    // A publisher the user removed stays untracked.
    const insert = db.prepare(
      "INSERT OR IGNORE INTO openrouter_publishers (id, name) VALUES (?, ?)",
    );
    for (const publisher of POPULAR_PUBLISHERS)
      insert.run(publisher.id, publisher.name);
  })();
}
