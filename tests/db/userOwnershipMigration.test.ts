import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrations";

test("migrations remove legacy agents while preserving sessions", () => {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      title TEXT,
      model TEXT,
      model_messages TEXT,
      agent_name TEXT
    )
  `);
  db.run(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE agent_tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE user_settings (
      owner_uuid TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY(owner_uuid, key)
    )
  `);
  db.run(
    "INSERT INTO sessions (id, created_at, updated_at, agent_name) VALUES ('session-1', 1, 1, 'system_agent')",
  );
  db.run(
    "INSERT INTO agents (id, name, created_at, updated_at) VALUES ('agent-1', 'general_agent', 1, 1)",
  );
  db.run(
    "INSERT INTO agent_tools (agent_id, tool_name) VALUES ('agent-1', 'bash')",
  );

  runMigrations(db);

  expect(db.query("SELECT id, owner_uuid FROM sessions").get()).toEqual({
    id: "session-1",
    owner_uuid: null,
  });
  const sessionColumns = db.query("PRAGMA table_info(sessions)").all() as {
    name: string;
  }[];
  expect(sessionColumns.map((column) => column.name)).not.toContain(
    "agent_name",
  );
  expect(
    db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'agent%' OR name = 'user_settings')",
      )
      .all(),
  ).toEqual([]);
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(
    (db.query("PRAGMA foreign_keys").get() as { foreign_keys: number })
      .foreign_keys,
  ).toBe(1);
  db.close();
});
