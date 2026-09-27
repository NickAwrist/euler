import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createAgentTables } from "../../src/db/agentTables";

test("migrates legacy inbox columns without changing IDs, delivery, or foreign keys", () => {
  const db = new Database(":memory:");
  try {
    db.run(`PRAGMA foreign_keys = ON;
      CREATE TABLE sessions (id TEXT PRIMARY KEY);
      INSERT INTO sessions VALUES ('chat');
      CREATE TABLE agents (id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, data TEXT);
      CREATE TABLE agent_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE, data TEXT);`);
    db.run("INSERT INTO agents VALUES (?, ?, ?)", [
      "agent",
      "chat",
      JSON.stringify({
        status: "idle",
        history: [{ role: "user", content: "task" }],
        title: "Agent",
      }),
    ]);
    for (const [id, deliveredAt, held] of [
      [12, null, false],
      [15, 456, true],
    ] as const)
      db.run("INSERT INTO agent_messages VALUES (?, ?, ?)", [
        id,
        "agent",
        JSON.stringify({
          sender: "user",
          kind: "user",
          content: "hello",
          wakes: true,
          held,
          attachmentIds: ["image"],
          createdAt: 123,
          deliveredAt,
        }),
      ]);
    createAgentTables(db);
    createAgentTables(db);
    expect(
      db
        .query(
          "SELECT id, delivered_at, held, wakes, attachment_ids FROM agent_messages ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: 12,
        delivered_at: null,
        held: 0,
        wakes: 1,
        attachment_ids: '["image"]',
      },
      {
        id: 15,
        delivered_at: 456,
        held: 1,
        wakes: 1,
        attachment_ids: '["image"]',
      },
    ]);
    expect(db.query("SELECT status, history, data FROM agents").get()).toEqual({
      status: "idle",
      history: '[{"role":"user","content":"task"}]',
      data: '{"title":"Agent"}',
    });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    const plan = db
      .query(
        "EXPLAIN QUERY PLAN SELECT agent_id FROM agent_messages WHERE delivered_at IS NULL AND held = 0 AND wakes = 1 GROUP BY agent_id ORDER BY MIN(id)",
      )
      .all();
    expect(JSON.stringify(plan)).toContain("idx_agent_messages_waking");
    db.run("DELETE FROM sessions WHERE id = 'chat'");
    expect(db.query("SELECT * FROM agent_messages").all()).toEqual([]);
  } finally {
    db.close();
  }
});

test("adds output attachments to existing inboxes without changing messages", () => {
  const db = new Database(":memory:");
  try {
    db.run("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
    createAgentTables(db);
    db.run("ALTER TABLE agent_messages DROP COLUMN attachments");
    db.run(
      "INSERT INTO agents (id, session_id, status, data) VALUES ('agent', 'chat', 'idle', '{}')",
    );
    db.run(
      "INSERT INTO agent_messages (agent_id, sender, kind, content, wakes, created_at) VALUES ('agent', 'child', 'result', 'Done', 1, 123)",
    );
    createAgentTables(db);
    createAgentTables(db);
    expect(
      db
        .query("SELECT content, attachments, delivered_at FROM agent_messages")
        .get(),
    ).toEqual({ content: "Done", attachments: "[]", delivered_at: null });
  } finally {
    db.close();
  }
});

test("moves subagent traces into per-activation rows and makes failed agents ready", () => {
  const db = new Database(":memory:");
  try {
    db.run("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
    createAgentTables(db);
    db.run("DROP TABLE agent_steps");
    const step = { kind: "llm_call", status: "done" };
    for (const [id, status, data] of [
      ["main", "idle", { kind: "main", steps: [step] }],
      ["child", "idle", { kind: "general", steps: [step, step] }],
      ["broken", "failed", { kind: "general", steps: [], endedAt: 5 }],
    ] as const)
      db.run(
        "INSERT INTO agents (id, session_id, status, data) VALUES (?, 'chat', ?, ?)",
        [id, status, JSON.stringify(data)],
      );
    createAgentTables(db);
    createAgentTables(db);
    expect(db.query("SELECT agent_id, steps FROM agent_steps").all()).toEqual([
      { agent_id: "child", steps: JSON.stringify([step, step]) },
    ]);
    expect(
      db.query("SELECT id, status, data FROM agents ORDER BY rowid").all(),
    ).toEqual([
      { id: "main", status: "idle", data: '{"kind":"main"}' },
      { id: "child", status: "idle", data: '{"kind":"general"}' },
      {
        id: "broken",
        status: "idle",
        data: '{"kind":"general","endedAt":null}',
      },
    ]);
  } finally {
    db.close();
  }
});
