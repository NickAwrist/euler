import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createAgentTables } from "../../src/db/agentTables";

test("migrates legacy inbox columns without changing IDs, delivery, or foreign keys", () => {
  const db = new Database(":memory:");
  try {
    db.run(`PRAGMA foreign_keys = ON;
      CREATE TABLE sessions (id TEXT PRIMARY KEY, owner_uuid TEXT, model TEXT, model_messages TEXT);
      INSERT INTO sessions (id) VALUES ('chat');
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
    expect(db.query("SELECT * FROM agents").get()).toEqual({
      id: "agent",
      session_id: "chat",
      status: "idle",
      data: '{"title":"Agent"}',
    });
    expect(db.query("SELECT * FROM agent_history").all()).toEqual([
      {
        agent_id: "agent",
        position: 0,
        message: '{"role":"user","content":"task"}',
      },
    ]);
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

test("moves traces and open replies into their own rows and makes failed agents ready", () => {
  const db = new Database(":memory:");
  try {
    db.run("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
    createAgentTables(db);
    db.run("DROP TABLE agent_steps");
    db.run("DROP TABLE agent_replies");
    const step = (n: number) => ({ kind: "llm_call", status: "done", n });
    for (const [id, status, data] of [
      [
        "main",
        "running",
        { kind: "main", partial: { content: "Partial", steps: [step(0)] } },
      ],
      [
        "child",
        "idle",
        {
          kind: "general",
          steps: [step(1), step(2)],
          partial: { content: "Done", steps: [step(2)] },
        },
      ],
      ["broken", "failed", { kind: "general", steps: [], endedAt: 5 }],
    ] as const)
      db.run(
        "INSERT INTO agents (id, session_id, status, data) VALUES (?, 'chat', ?, ?)",
        [id, status, JSON.stringify(data)],
      );
    createAgentTables(db);
    createAgentTables(db);
    expect(
      db
        .query(
          "SELECT agent_id, position, step FROM agent_steps ORDER BY rowid",
        )
        .all(),
    ).toEqual([
      { agent_id: "child", position: 0, step: JSON.stringify(step(1)) },
      { agent_id: "child", position: 1, step: JSON.stringify(step(2)) },
      { agent_id: "main", position: 0, step: JSON.stringify(step(0)) },
    ]);
    expect(db.query("SELECT * FROM agent_replies").all()).toEqual([
      { agent_id: "main", content: "Partial" },
    ]);
    expect(
      db.query("SELECT id, status, data FROM agents ORDER BY rowid").all(),
    ).toEqual([
      { id: "main", status: "running", data: '{"kind":"main"}' },
      { id: "child", status: "idle", data: '{"kind":"general"}' },
      {
        id: "broken",
        status: "idle",
        data: '{"kind":"general","endedAt":null}',
      },
    ]);

    db.run(`DROP TABLE agent_steps;
      CREATE TABLE agent_steps (agent_id TEXT, activation_id TEXT, steps TEXT);`);
    db.run(
      "INSERT INTO agent_steps VALUES ('child', 'first', ?), ('child', 'second', ?)",
      [JSON.stringify([step(1), step(2)]), JSON.stringify([step(3)])],
    );
    createAgentTables(db);
    expect(
      db
        .query(
          "SELECT activation_id, position, step FROM agent_steps ORDER BY rowid",
        )
        .all(),
    ).toEqual([
      { activation_id: "first", position: 0, step: JSON.stringify(step(1)) },
      { activation_id: "first", position: 1, step: JSON.stringify(step(2)) },
      { activation_id: "second", position: 0, step: JSON.stringify(step(3)) },
    ]);
  } finally {
    db.close();
  }
});

test("moves model history into per-message rows and gives older chats a main agent", () => {
  const db = new Database(":memory:");
  try {
    const message = (content: string) => ({ role: "user", content });
    db.run(`PRAGMA foreign_keys = ON;
      CREATE TABLE sessions (id TEXT PRIMARY KEY, owner_uuid TEXT, model TEXT, model_messages TEXT);
      CREATE TABLE agents (id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, data TEXT);
      CREATE TABLE agent_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE, data TEXT);`);
    for (const [id, history] of [
      ["chat", JSON.stringify([message("main")])],
      ["older", JSON.stringify([message("older")])],
      ["unreadable", "{not json"],
      ["empty", null],
    ] as const)
      db.run("INSERT INTO sessions VALUES (?, 'owner', 'test-model', ?)", [
        id,
        history,
      ]);
    for (const [id, data] of [
      ["main", { kind: "main", status: "idle" }],
      [
        "child",
        { kind: "general", status: "idle", history: [message("child")] },
      ],
    ] as const)
      db.run("INSERT INTO agents VALUES (?, 'chat', ?)", [
        id,
        JSON.stringify(data),
      ]);
    createAgentTables(db);
    createAgentTables(db);
    const history = (session: string) =>
      db
        .query(
          `SELECT json_extract(a.data, '$.kind') AS kind, h.position, h.message
           FROM agents a LEFT JOIN agent_history h ON h.agent_id = a.id
           WHERE a.session_id = ? ORDER BY a.rowid, h.position`,
        )
        .all(session);
    expect(history("chat")).toEqual([
      { kind: "main", position: 0, message: JSON.stringify(message("main")) },
      {
        kind: "general",
        position: 0,
        message: JSON.stringify(message("child")),
      },
    ]);
    expect(history("older")).toEqual([
      { kind: "main", position: 0, message: JSON.stringify(message("older")) },
    ]);
    expect(history("unreadable")).toEqual([
      { kind: "main", position: null, message: null },
    ]);
    expect(history("empty")).toEqual([]);
    expect(
      db
        .query("SELECT data FROM agents WHERE session_id = 'older'")
        .all()
        .map((row) => JSON.parse((row as { data: string }).data)),
    ).toEqual([
      expect.objectContaining({
        ownerUuid: "owner",
        sessionId: "older",
        kind: "main",
        model: "test-model",
      }),
    ]);
    const columns = (table: string) =>
      (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (column) => column.name,
      );
    expect(columns("sessions")).not.toContain("model_messages");
    expect(columns("agents")).not.toContain("history");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
