import type { Database } from "bun:sqlite";
import { DEFAULT_RUN_MODEL } from "../constants";
import { createAgentRecord } from "./agentRecord";

const AGENTS = `CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  data TEXT NOT NULL
)`;
const AGENT_MESSAGES = `CREATE TABLE IF NOT EXISTS agent_messages (
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
const AGENT_HISTORY = `CREATE TABLE IF NOT EXISTS agent_history (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  message TEXT NOT NULL,
  PRIMARY KEY (agent_id, position)
)`;
/** One row per trace step, so saving a step writes only that step. */
const AGENT_STEPS = `CREATE TABLE IF NOT EXISTS agent_steps (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  activation_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  step TEXT NOT NULL,
  PRIMARY KEY (agent_id, activation_id, position)
)`;
/** The main agent's reply text since its last transcript segment. */
const AGENT_REPLIES = `CREATE TABLE IF NOT EXISTS agent_replies (
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

/** Creates the agent tables. */
export function createAgentTables(db: Database) {
  db.run(
    `${AGENTS}; ${AGENT_MESSAGES}; ${AGENT_HISTORY}; ${AGENT_STEPS}; ${AGENT_REPLIES}; ${INDEXES}`,
  );
  const sessionColumns = db.query("PRAGMA table_info(sessions)").all() as {
    name: string;
  }[];
  if (sessionColumns.some((c) => c.name === "model_messages")) moveHistory(db);
}

/**
 * Model history was once one JSON array in `sessions.model_messages`. Each
 * chat gets a main agent so its model history is kept. One-shot: delete once
 * it has run.
 */
function moveHistory(db: Database) {
  const chats = db
    .query(
      "SELECT id, owner_uuid, model FROM sessions WHERE model_messages IS NOT NULL",
    )
    .all() as { id: string; owner_uuid: string; model: string | null }[];
  const insertAgent = db.prepare(
    "INSERT INTO agents (id, session_id, status, data) VALUES (?, ?, 'idle', ?)",
  );
  db.transaction(() => {
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
    db.run(`INSERT INTO agent_history (agent_id, position, message)
      SELECT a.id, h.key, h.value FROM agents a
      JOIN sessions s ON s.id = a.session_id, json_each(
        CASE WHEN json_valid(s.model_messages)
          THEN CASE WHEN json_type(s.model_messages) = 'array'
            THEN s.model_messages ELSE '[]' END
          ELSE '[]' END) h;
      ALTER TABLE sessions DROP COLUMN model_messages;`);
  })();
}
