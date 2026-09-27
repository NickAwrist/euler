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
