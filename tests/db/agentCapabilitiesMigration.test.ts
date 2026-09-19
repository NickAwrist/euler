import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  migrateAgentDelegations,
  migrateAgentSkills,
  migrateFileEditingTools,
} from "../../src/db/migrations";

function legacyDatabase(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      owner_uuid TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(owner_uuid, name)
    )
  `);
  db.run(`
    CREATE TABLE agent_tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(agent_id, tool_name)
    )
  `);
  db.run(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY,
      owner_uuid TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      instructions TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(owner_uuid, name)
    )
  `);
  return db;
}

function insertAgent(
  db: Database,
  id: string,
  ownerUuid: string,
  name: string,
): void {
  db.run(
    "INSERT INTO agents (id, owner_uuid, name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)",
    [id, ownerUuid, name],
  );
}

describe("agent capability migrations", () => {
  test("backfills existing same-owner skills only once", () => {
    const db = legacyDatabase();
    insertAgent(db, "source", "user-1", "source");
    insertAgent(db, "second", "user-1", "second");
    insertAgent(db, "other", "user-2", "other");
    db.run(
      "INSERT INTO skills VALUES ('skill-1', 'user-1', 'one', 'One', 'First', 1, 1)",
    );
    db.run(
      "INSERT INTO skills VALUES ('skill-2', 'user-2', 'two', 'Two', 'Second', 1, 1)",
    );

    migrateAgentSkills(db);

    expect(
      db
        .query(
          "SELECT agent_id, skill_id FROM agent_skills ORDER BY agent_id, skill_id",
        )
        .all(),
    ).toEqual([
      { agent_id: "other", skill_id: "skill-2" },
      { agent_id: "second", skill_id: "skill-1" },
      { agent_id: "source", skill_id: "skill-1" },
    ]);

    db.run(
      "INSERT INTO skills VALUES ('skill-new', 'user-1', 'new', 'New', 'New', 2, 2)",
    );
    migrateAgentSkills(db);
    expect(
      db.query("SELECT 1 FROM agent_skills WHERE skill_id = 'skill-new'").get(),
    ).toBeNull();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("moves same-owner agent names to routes and removes stale tools", () => {
    const db = legacyDatabase();
    insertAgent(db, "source", "user-1", "source");
    insertAgent(db, "reviewer", "user-1", "reviewer");
    insertAgent(db, "other-reviewer", "user-2", "reviewer");
    db.run(
      "INSERT INTO agent_tools (agent_id, tool_name, position) VALUES ('source', 'bash', 0)",
    );
    db.run(
      "INSERT INTO agent_tools (agent_id, tool_name, position) VALUES ('source', 'reviewer', 1)",
    );
    db.run(
      "INSERT INTO agent_tools (agent_id, tool_name, position) VALUES ('source', 'missing_agent', 2)",
    );

    migrateAgentDelegations(db);

    expect(db.query("SELECT tool_name FROM agent_tools").all()).toEqual([
      { tool_name: "bash" },
    ]);
    expect(db.query("SELECT * FROM agent_delegations").all()).toEqual([
      {
        source_agent_id: "source",
        target_agent_id: "reviewer",
        position: 1,
      },
    ]);

    db.run("UPDATE agents SET name = 'renamed' WHERE id = 'reviewer'");
    expect(
      db.query("SELECT target_agent_id FROM agent_delegations").get(),
    ).toEqual({ target_agent_id: "reviewer" });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("skill and agent deletion cascades join rows", () => {
    const db = legacyDatabase();
    insertAgent(db, "source", "user-1", "source");
    insertAgent(db, "target", "user-1", "target");
    db.run(
      "INSERT INTO skills VALUES ('skill-1', 'user-1', 'one', 'One', 'First', 1, 1)",
    );
    migrateAgentSkills(db);
    migrateAgentDelegations(db);
    db.run(
      "INSERT INTO agent_delegations (source_agent_id, target_agent_id) VALUES ('source', 'target')",
    );

    db.run("DELETE FROM skills WHERE id = 'skill-1'");
    expect(db.query("SELECT * FROM agent_skills").all()).toEqual([]);
    db.run("DELETE FROM agents WHERE id = 'target'");
    expect(db.query("SELECT * FROM agent_delegations").all()).toEqual([]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});

test("enables patch editing once for existing shell and file tools", () => {
  const db = legacyDatabase();
  db.run(
    "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  insertAgent(db, "source", "user-1", "source");
  insertAgent(db, "editor", "user-1", "editor");
  db.run(
    "INSERT INTO agent_tools (agent_id, tool_name, position) VALUES ('source', 'bash', 0), ('editor', 'create_file', 0)",
  );
  migrateFileEditingTools(db);
  expect(
    db
      .query(
        "SELECT tool_name FROM agent_tools WHERE agent_id = 'source' ORDER BY position",
      )
      .all(),
  ).toEqual([{ tool_name: "bash" }, { tool_name: "apply_patch" }]);
  expect(
    db
      .query(
        "SELECT tool_name FROM agent_tools WHERE agent_id = 'editor' ORDER BY position",
      )
      .all(),
  ).toEqual([{ tool_name: "create_file" }, { tool_name: "apply_patch" }]);
  db.run("DELETE FROM agent_tools WHERE tool_name = 'apply_patch'");
  migrateFileEditingTools(db);
  expect(
    db.query("SELECT 1 FROM agent_tools WHERE tool_name = 'apply_patch'").get(),
  ).toBeNull();
  db.close();
});
