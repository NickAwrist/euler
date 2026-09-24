import type { Database } from "bun:sqlite";
import { POPULAR_PUBLISHERS } from "../openRouterPublishers";
import { migrateAttachmentMetadata } from "./attachmentMetadataMigration";

function tableExists(db: Database, name: string): boolean {
  return (
    db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== null
  );
}

export function migrateSessionsDirectoryColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(sessions)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "session_directory")) {
    db.run("ALTER TABLE sessions ADD COLUMN session_directory TEXT");
  }
}

export function migrateSessionsWorkspaceKindColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(sessions)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "workspace_kind")) {
    db.run(
      "ALTER TABLE sessions ADD COLUMN workspace_kind TEXT NOT NULL DEFAULT 'sandbox'",
    );
  }
  db.run(`
    UPDATE sessions
    SET workspace_kind = CASE
      WHEN session_directory IS NOT NULL AND trim(session_directory) != '' THEN 'local'
      ELSE 'sandbox'
    END
    WHERE workspace_kind NOT IN ('sandbox', 'local')
       OR (workspace_kind = 'sandbox' AND session_directory IS NOT NULL AND trim(session_directory) != '')
       OR (workspace_kind = 'local' AND (session_directory IS NULL OR trim(session_directory) = ''))
  `);
}

export function migrateSessionsOwnerColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(sessions)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "owner_uuid")) {
    db.run("ALTER TABLE sessions ADD COLUMN owner_uuid TEXT");
  }
}

export function migrateMessagesAttachmentsColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(messages)").all() as {
    name: string;
  }[];
  if (cols.length === 0) return;
  if (!cols.some((c) => c.name === "attachments")) {
    db.run("ALTER TABLE messages ADD COLUMN attachments TEXT");
  }
}

export function migrateOpenRouterCatalog(db: Database) {
  db.transaction(() => {
    const columns = db.query("PRAGMA table_info(openrouter_models)").all() as {
      name: string;
    }[];
    // The old schema is the one-time migration marker. Never reset the new table.
    if (
      columns.length &&
      !columns.some((column) => column.name === "enabled")
    ) {
      db.run("DROP TABLE openrouter_models");
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS openrouter_publishers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subscribed INTEGER NOT NULL DEFAULT 0 CHECK (subscribed IN (0, 1)),
        subscribed_at INTEGER,
        CHECK (subscribed = 0 OR subscribed_at IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS openrouter_models (
        route TEXT PRIMARY KEY,
        publisher_id TEXT NOT NULL REFERENCES openrouter_publishers(id),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        catalog_created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_openrouter_models_publisher_enabled
        ON openrouter_models(publisher_id, enabled);
      CREATE TABLE IF NOT EXISTS model_favorites (
        provider TEXT NOT NULL CHECK (provider IN ('openrouter', 'ollama')),
        model_id TEXT NOT NULL,
        PRIMARY KEY (provider, model_id)
      );
    `);
    const publisherColumns = db
      .query("PRAGMA table_info(openrouter_publishers)")
      .all() as { name: string }[];
    if (!publisherColumns.some((column) => column.name === "tracked")) {
      db.run(
        "ALTER TABLE openrouter_publishers ADD COLUMN tracked INTEGER NOT NULL DEFAULT 1 CHECK (tracked IN (0, 1))",
      );
    }
    if (tableExists(db, "app_settings")) {
      db.run(
        "DELETE FROM app_settings WHERE key IN ('openrouter_models_seeded_v1', 'openrouter_models_seeded_v2', 'openrouter_models_seeded_v3')",
      );
    }
    const insert = db.prepare(
      "INSERT OR IGNORE INTO openrouter_publishers (id, name) VALUES (?, ?)",
    );
    for (const publisher of POPULAR_PUBLISHERS)
      insert.run(publisher.id, publisher.name);
  })();
}

/** Remove configurable agents; every run now uses the single built-in agent. */
export function migrateRemoveAgents(db: Database) {
  db.transaction(() => {
    db.run("DROP TABLE IF EXISTS agent_delegations");
    db.run("DROP TABLE IF EXISTS agent_skills");
    db.run("DROP TABLE IF EXISTS agent_tools");
    db.run("DROP TABLE IF EXISTS agents");
    const sessionColumns = db.query("PRAGMA table_info(sessions)").all() as {
      name: string;
    }[];
    if (sessionColumns.some((column) => column.name === "agent_name")) {
      db.run("ALTER TABLE sessions DROP COLUMN agent_name");
    }
    db.run("DROP TABLE IF EXISTS user_settings");
    if (tableExists(db, "app_settings")) {
      db.run(
        "DELETE FROM app_settings WHERE key IN ('default_run_agent', 'file_editing_tools_v1')",
      );
    }
  })();
}

export function runMigrations(db: Database) {
  migrateOpenRouterCatalog(db);
  migrateSessionsDirectoryColumn(db);
  migrateSessionsWorkspaceKindColumn(db);
  migrateSessionsOwnerColumn(db);
  migrateRemoveAgents(db);
  migrateMessagesAttachmentsColumn(db);
  if (tableExists(db, "messages")) migrateAttachmentMetadata(db);
}
