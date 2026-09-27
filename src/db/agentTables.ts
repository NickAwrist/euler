import type { Database } from "bun:sqlite";
import { DEFAULT_RUN_MODEL } from "../constants";
import { createAgentRecord } from "./agentRecord";

const AGENTS = `CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  data TEXT NOT NULL
)`;
const AGENT_MESSAGES = `CREATE TABLE agent_messages (
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
)`;
/** One row per model message, so saving history writes only what changed. */
const AGENT_HISTORY = `CREATE TABLE agent_history (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  message TEXT NOT NULL,
  PRIMARY KEY (agent_id, position)
)`;
/** One row per trace step, so saving a step writes only that step. */
const AGENT_STEPS = `CREATE TABLE agent_steps (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  activation_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  step TEXT NOT NULL,
  PRIMARY KEY (agent_id, activation_id, position)
)`;
/** The main agent's reply text since its last transcript segment. */
const AGENT_REPLIES = `CREATE TABLE agent_replies (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL
)`;
const INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id, status);
  CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
  CREATE INDEX IF NOT EXISTS idx_agent_messages_recipient ON agent_messages(agent_id, id);
  CREATE INDEX IF NOT EXISTS idx_agent_messages_waking
    ON agent_messages(held, wakes, agent_id, id) WHERE delivered_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_agent_messages_undelivered
    ON agent_messages(agent_id, id) WHERE delivered_at IS NULL;`;

const columns = (db: Database, table: string) =>
  (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );

/** Creates the agent tables and upgrades tables from earlier versions. */
export function createAgentTables(db: Database) {
  const agentColumns = columns(db, "agents");
  if (!agentColumns.length)
    db.run(
      `${AGENTS}; ${AGENT_MESSAGES}; ${AGENT_HISTORY}; ${AGENT_STEPS}; ${AGENT_REPLIES}`,
    );
  else if (!agentColumns.includes("status")) moveDataIntoColumns(db);
  else if (!columns(db, "agent_messages").includes("attachments"))
    db.run(
      "ALTER TABLE agent_messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'",
    );
  db.run(INDEXES);
  if (!columns(db, "agent_steps").includes("position")) moveSteps(db);
  if (!columns(db, "agent_replies").length) moveReplies(db);
  if (columns(db, "sessions").includes("model_messages")) moveHistory(db);
}

/**
 * A main agent's open reply was once kept in `data`, with its steps. Subagent
 * records kept one too, but their trace is already in `agent_steps`.
 */
function moveReplies(db: Database) {
  db.transaction(() => {
    db.run(`${AGENT_REPLIES};
      INSERT INTO agent_replies (agent_id, content)
      SELECT id, coalesce(json_extract(data, '$.partial.content'), '')
      FROM agents WHERE json_extract(data, '$.kind') = 'main'
        AND json_type(data, '$.partial') = 'object';
      INSERT INTO agent_steps (agent_id, activation_id, position, step)
      SELECT a.id, 'migrated', s.key, s.value
      FROM agents a, json_each(a.data, '$.partial.steps') s
      WHERE json_extract(a.data, '$.kind') = 'main'
        AND json_type(a.data, '$.partial.steps') = 'array'
      ORDER BY a.rowid, s.key;
      UPDATE agents SET data = json_remove(data, '$.partial')
      WHERE json_type(data, '$.partial') IS NOT NULL;`);
  })();
}

/**
 * Traces were once a JSON array per activation in `agent_steps`, and before
 * that a subagent's whole trace in `data`, when an error ended a subagent as
 * `failed`. Errors now leave the agent ready, so those agents become ready.
 */
function moveSteps(db: Database) {
  const arrays = columns(db, "agent_steps").length > 0;
  db.transaction(() => {
    if (arrays) db.run("ALTER TABLE agent_steps RENAME TO agent_step_arrays");
    db.run(AGENT_STEPS);
    if (arrays)
      db.run(`INSERT INTO agent_steps (agent_id, activation_id, position, step)
        SELECT a.agent_id, a.activation_id, s.key, s.value
        FROM agent_step_arrays a, json_each(a.steps) s ORDER BY a.rowid, s.key;
        DROP TABLE agent_step_arrays;`);
    else
      db.run(`INSERT INTO agent_steps (agent_id, activation_id, position, step)
        SELECT a.id, 'migrated', s.key, s.value
        FROM agents a, json_each(a.data, '$.steps') s
        WHERE json_extract(a.data, '$.kind') != 'main'
        ORDER BY a.rowid, s.key;
        UPDATE agents SET data = json_remove(data, '$.steps')
        WHERE json_type(data, '$.steps') IS NOT NULL;
        UPDATE agents SET status = 'idle', data = json_set(data, '$.endedAt', NULL)
        WHERE status = 'failed';`);
  })();
}

/**
 * Model history was once one JSON array: `sessions.model_messages` for the
 * main agent and `agents.history` for a subagent. Chats from before agents
 * existed get a main agent so their model history is kept.
 */
function moveHistory(db: Database) {
  const subagentHistory = columns(db, "agents").includes("history");
  const chats = db
    .query(
      `SELECT id, owner_uuid, model FROM sessions s
       WHERE model_messages IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM agents a
         WHERE a.session_id = s.id AND json_extract(a.data, '$.kind') = 'main')`,
    )
    .all() as { id: string; owner_uuid: string; model: string | null }[];
  const insertAgent = db.prepare(
    "INSERT INTO agents (id, session_id, status, data) VALUES (?, ?, 'idle', ?)",
  );
  db.transaction(() => {
    if (!columns(db, "agent_history").length) db.run(AGENT_HISTORY);
    for (const chat of chats) {
      const {
        history: _history,
        status: _status,
        ...main
      } = createAgentRecord({
        ownerUuid: chat.owner_uuid,
        sessionId: chat.id,
        parentId: null,
        kind: "main",
        title: "Euler",
        status: "idle",
        model: chat.model ?? DEFAULT_RUN_MODEL,
        spawnPosition: 0,
        activity: "",
        config: {},
      });
      insertAgent.run(main.id, chat.id, JSON.stringify(main));
    }
    // Unreadable history cannot be recovered, so it starts empty.
    db.run(`WITH sources AS (
        SELECT a.id, CASE WHEN json_extract(a.data, '$.kind') = 'main'
          THEN s.model_messages ELSE ${subagentHistory ? "a.history" : "'[]'"}
          END AS history
        FROM agents a JOIN sessions s ON s.id = a.session_id)
      INSERT INTO agent_history (agent_id, position, message)
      SELECT sources.id, h.key, h.value FROM sources, json_each(
        CASE WHEN json_valid(sources.history)
          THEN CASE WHEN json_type(sources.history) = 'array'
            THEN sources.history ELSE '[]' END
          ELSE '[]' END) h;
      ALTER TABLE sessions DROP COLUMN model_messages;`);
    if (subagentHistory) db.run("ALTER TABLE agents DROP COLUMN history");
  })();
}

/**
 * Tables from before status and delivery had their own columns kept
 * everything in `data`; their rows are moved into the columns.
 */
function moveDataIntoColumns(db: Database) {
  // Swapping tables with foreign keys must happen outside a transaction.
  db.run("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.run(`CREATE TABLE agents_next (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          history TEXT NOT NULL DEFAULT '[]',
          data TEXT NOT NULL
        );
        INSERT INTO agents_next (id, session_id, status, history, data)
        SELECT id, session_id, json_extract(data, '$.status'),
          coalesce(json_extract(data, '$.history'), '[]'),
          json_remove(data, '$.status', '$.history')
        FROM agents;
        ${AGENT_MESSAGES.replace("agent_messages", "agent_messages_next")};
        INSERT INTO agent_messages_next (id, agent_id, sender, kind, content,
          wakes, held, attachment_ids, created_at, delivered_at)
        SELECT id, agent_id, json_extract(data, '$.sender'),
          json_extract(data, '$.kind'), json_extract(data, '$.content'),
          json_extract(data, '$.wakes'), coalesce(json_extract(data, '$.held'), 0),
          coalesce(json_extract(data, '$.attachmentIds'), '[]'),
          json_extract(data, '$.createdAt'), json_extract(data, '$.deliveredAt')
        FROM agent_messages;
        DROP TABLE agent_messages;
        DROP TABLE agents;
        ALTER TABLE agents_next RENAME TO agents;
        ALTER TABLE agent_messages_next RENAME TO agent_messages;
        ${INDEXES}`);
    })();
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
}
