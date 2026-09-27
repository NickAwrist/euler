import type { Database } from "bun:sqlite";

const AGENTS = `CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  history TEXT NOT NULL DEFAULT '[]',
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
/** One row per activation, so a step write stays proportional to that activation. */
const AGENT_STEPS = `CREATE TABLE agent_steps (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  activation_id TEXT NOT NULL,
  steps TEXT NOT NULL,
  PRIMARY KEY (agent_id, activation_id)
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
  if (!agentColumns.length) db.run(`${AGENTS}; ${AGENT_MESSAGES}; ${INDEXES}`);
  else if (!agentColumns.includes("status")) moveDataIntoColumns(db);
  else {
    if (!columns(db, "agent_messages").includes("attachments"))
      db.run(
        "ALTER TABLE agent_messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'",
      );
    db.run(INDEXES);
  }
  if (!columns(db, "agent_steps").length) createStepTable(db);
}

/**
 * Records from before steps had their own table kept a subagent's whole trace
 * in `data`, and a subagent error ended it as `failed`. Errors now leave the
 * agent ready, so those agents become ready again.
 */
function createStepTable(db: Database) {
  db.transaction(() => {
    db.run(`${AGENT_STEPS};
      INSERT INTO agent_steps (agent_id, activation_id, steps)
      SELECT id, 'migrated', json_extract(data, '$.steps') FROM agents
      WHERE json_extract(data, '$.kind') != 'main'
        AND json_array_length(data, '$.steps') > 0;
      UPDATE agents SET data = json_remove(data, '$.steps')
      WHERE json_type(data, '$.steps') IS NOT NULL;
      UPDATE agents SET status = 'idle', data = json_set(data, '$.endedAt', NULL)
      WHERE status = 'failed';`);
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
      db.run(`${AGENTS.replace("agents", "agents_next")};
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
