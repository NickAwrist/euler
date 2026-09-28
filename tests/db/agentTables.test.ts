import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createAgentTables } from "../../src/db/agentTables";

test("moves model history into per-message rows under a new main agent", () => {
  const db = new Database(":memory:");
  try {
    const message = (content: string) => ({ role: "user", content });
    db.run(`PRAGMA foreign_keys = ON;
      CREATE TABLE sessions (id TEXT PRIMARY KEY, owner_uuid TEXT, model TEXT, model_messages TEXT);`);
    for (const [id, history] of [
      ["chat", JSON.stringify([message("first"), message("second")])],
      ["unreadable", "{not json"],
      ["empty", null],
    ] as const)
      db.run("INSERT INTO sessions VALUES (?, 'owner', 'test-model', ?)", [
        id,
        history,
      ]);
    createAgentTables(db);
    createAgentTables(db);
    const history = (session: string) =>
      db
        .query(
          `SELECT json_extract(a.data, '$.kind') AS kind, h.position, h.message
           FROM agents a LEFT JOIN agent_history h ON h.agent_id = a.id
           WHERE a.session_id = ? ORDER BY h.position`,
        )
        .all(session);
    expect(history("chat")).toEqual([
      { kind: "main", position: 0, message: JSON.stringify(message("first")) },
      { kind: "main", position: 1, message: JSON.stringify(message("second")) },
    ]);
    expect(history("unreadable")).toEqual([
      { kind: "main", position: null, message: null },
    ]);
    // A chat without model history gets its main agent when first used.
    expect(history("empty")).toEqual([]);
    const main = db
      .query("SELECT data FROM agents WHERE session_id = 'chat'")
      .get() as { data: string };
    expect(JSON.parse(main.data)).toMatchObject({
      ownerUuid: "owner",
      sessionId: "chat",
      kind: "main",
      model: "test-model",
    });
    expect(
      (db.query("PRAGMA table_info(sessions)").all() as { name: string }[]).map(
        (column) => column.name,
      ),
    ).not.toContain("model_messages");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
