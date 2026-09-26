import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./constants";
import { runMigrations } from "./migrations";

let dbSingleton: Database | null = null;

export function getDb(): Database {
  if (dbSingleton) return dbSingleton;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.run("PRAGMA foreign_keys = ON;");
  db.run("PRAGMA journal_mode = WAL;");
  db.run(`CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_uuid TEXT NOT NULL, model TEXT NOT NULL, timestamp INTEGER NOT NULL,
    input INTEGER, output INTEGER, cached INTEGER, cost REAL, savings REAL
  )`);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_usage_owner_time ON usage_events(owner_uuid, timestamp)",
  );
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      owner_uuid TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      title TEXT,
      model TEXT,
      model_messages TEXT,
      session_directory TEXT,
      workspace_kind TEXT NOT NULL DEFAULT 'sandbox'
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      steps TEXT,
      position INTEGER NOT NULL
    );
  `);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_messages_session_position ON messages(session_id, position);",
  );
  db.run(`
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
  `);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_attachments_owner_session ON attachments(owner_uuid, session_id);",
  );

  db.run(`
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
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  runMigrations(db);

  dbSingleton = db;
  return db;
}

export function resetDbConnection(): void {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
}
