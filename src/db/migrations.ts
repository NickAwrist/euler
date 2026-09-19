import type { Database } from "bun:sqlite";
import { POPULAR_PUBLISHERS } from "../openRouterPublishers";
import { isBuiltinToolName } from "../tools/builtinTools";
import { migrateAttachmentMetadata } from "./attachmentMetadataMigration";

function tableExists(db: Database, name: string): boolean {
  return (
    db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== null
  );
}

function foreignKeysEnabled(db: Database): boolean {
  return (
    (db.query("PRAGMA foreign_keys").get() as { foreign_keys: number })
      .foreign_keys === 1
  );
}

export function migrateSessionsAgentColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(sessions)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "agent_name")) {
    db.run("ALTER TABLE sessions ADD COLUMN agent_name TEXT");
  }
}

export function migrateSessionsDirectoryColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(sessions)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "session_directory")) {
    db.run("ALTER TABLE sessions ADD COLUMN session_directory TEXT");
  }
}

export function migrateSessionsWorkspaceKindColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(sessions)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "workspace_kind")) {
    db.run(
      "ALTER TABLE sessions ADD COLUMN workspace_kind TEXT NOT NULL DEFAULT 'sandbox'",
    );
  }
  db.run(`
    UPDATE sessions
    SET workspace_kind = CASE
      WHEN session_directory IS NOT NULL AND trim(session_directory) != '' THEN 'local'
      ELSE 'sandbox'
    END
    WHERE workspace_kind NOT IN ('sandbox', 'local')
       OR (workspace_kind = 'sandbox' AND session_directory IS NOT NULL AND trim(session_directory) != '')
       OR (workspace_kind = 'local' AND (session_directory IS NULL OR trim(session_directory) = ''))
  `);
}

export function migrateSessionsOwnerColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(sessions)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "owner_uuid")) {
    db.run("ALTER TABLE sessions ADD COLUMN owner_uuid TEXT");
  }
}

export function migrateMessagesAttachmentsColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(messages)").all() as {
    name: string;
  }[];
  if (cols.length === 0) return;
  if (!cols.some((c) => c.name === "attachments")) {
    db.run("ALTER TABLE messages ADD COLUMN attachments TEXT");
  }
}

export function migrateAgentsOwnerColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(agents)").all() as {
    name: string;
  }[];
  if (cols.some((c) => c.name === "owner_uuid")) return;

  const restoreForeignKeys = foreignKeysEnabled(db);
  db.run("PRAGMA foreign_keys = OFF");
  try {
    const tx = db.transaction(() => {
      db.run(`
        CREATE TABLE agents_with_owners (
          id TEXT PRIMARY KEY,
          owner_uuid TEXT,
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
        INSERT INTO agents_with_owners
          (id, owner_uuid, name, description, system_prompt, is_default, created_at, updated_at)
        SELECT id, NULL, name, description, system_prompt, is_default, created_at, updated_at
        FROM agents
      `);
      db.run("DROP TABLE agents");
      db.run("ALTER TABLE agents_with_owners RENAME TO agents");
    });
    tx();
  } finally {
    db.run(`PRAGMA foreign_keys = ${restoreForeignKeys ? "ON" : "OFF"}`);
  }
}

export function migrateAgentSkills(db: Database) {
  if (tableExists(db, "agent_skills")) return;
  if (!tableExists(db, "agents") || !tableExists(db, "skills")) return;

  const tx = db.transaction(() => {
    db.run(`
      CREATE TABLE agent_skills (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (agent_id, skill_id)
      )
    `);
    db.run(`
      INSERT INTO agent_skills (agent_id, skill_id, position)
      SELECT
        agent_id,
        skill_id,
        ROW_NUMBER() OVER (
          PARTITION BY agent_id
          ORDER BY skill_created_at, skill_id
        ) - 1
      FROM (
        SELECT
          agents.id AS agent_id,
          skills.id AS skill_id,
          skills.created_at AS skill_created_at
        FROM agents
        INNER JOIN skills ON skills.owner_uuid = agents.owner_uuid
      )
    `);
  });
  tx();
}

export function migrateAgentDelegations(db: Database) {
  if (tableExists(db, "agent_delegations")) return;
  if (!tableExists(db, "agents") || !tableExists(db, "agent_tools")) return;

  const tx = db.transaction(() => {
    db.run(`
      CREATE TABLE agent_delegations (
        source_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (source_agent_id, target_agent_id),
        CHECK (source_agent_id != target_agent_id)
      )
    `);

    const legacyRows = db
      .query(`
        SELECT
          agent_tools.id,
          agent_tools.agent_id,
          agent_tools.tool_name,
          agent_tools.position,
          agents.owner_uuid
        FROM agent_tools
        INNER JOIN agents ON agents.id = agent_tools.agent_id
        ORDER BY agent_tools.id
      `)
      .all() as Array<{
      id: number;
      agent_id: string;
      tool_name: string;
      position: number;
      owner_uuid: string | null;
    }>;
    const findTarget = db.query(
      "SELECT id FROM agents WHERE owner_uuid IS ? AND name = ?",
    );
    const insertRoute = db.prepare(
      "INSERT OR IGNORE INTO agent_delegations (source_agent_id, target_agent_id, position) VALUES (?, ?, ?)",
    );
    const removeLegacyTool = db.prepare("DELETE FROM agent_tools WHERE id = ?");

    for (const row of legacyRows) {
      if (isBuiltinToolName(row.tool_name)) continue;
      const target = findTarget.get(row.owner_uuid, row.tool_name) as {
        id: string;
      } | null;
      if (target && target.id !== row.agent_id) {
        insertRoute.run(row.agent_id, target.id, row.position);
      }
      removeLegacyTool.run(row.id);
    }
  });
  tx();
}

export function migrateSeededComputerAgentName(db: Database) {
  if (!tableExists(db, "agents")) return;
  const rows = db
    .query(
      `SELECT id, owner_uuid FROM agents
       WHERE name = 'computer_agent'
         AND description LIKE 'Runs shell commands, manages files,%'`,
    )
    .all() as Array<{ id: string; owner_uuid: string | null }>;
  const updateAgent = db.prepare(
    `UPDATE agents
     SET name = 'system_agent',
         description = 'Uses contained shell and file tools in the active chat workspace. Provide a self-contained task description with the expected output or deliverable.',
         system_prompt = replace(system_prompt, 'You are a computer-use agent with access to a bash shell. You execute commands, manage files, and interact with the operating system to complete tasks.', 'You are a system agent with contained shell and file access to the active chat workspace.'),
         updated_at = ?
     WHERE id = ?`,
  );
  for (const row of rows) {
    const conflict = db
      .query(
        "SELECT 1 FROM agents WHERE owner_uuid IS ? AND name = 'system_agent'",
      )
      .get(row.owner_uuid);
    if (conflict) continue;
    updateAgent.run(Date.now(), row.id);
    db.run(
      "UPDATE sessions SET agent_name = 'system_agent' WHERE owner_uuid IS ? AND agent_name = 'computer_agent'",
      [row.owner_uuid],
    );
    db.run(
      "UPDATE user_settings SET value = 'system_agent' WHERE owner_uuid IS ? AND key = 'default_run_agent' AND value = 'computer_agent'",
      [row.owner_uuid],
    );
  }
}

/**
 * One-shot migration from the old `include_personalization` / `include_session_directory` /
 * `include_os_info` flags to inline `{{PLACEHOLDER}}` tokens in `system_prompt`.
 */
export function migrateAgentsInlinePlaceholders(db: Database) {
  const cols = db.query("PRAGMA table_info(agents)").all() as {
    name: string;
  }[];
  const columnNames = new Set(cols.map((column) => column.name));
  const hasAny =
    columnNames.has("include_personalization") ||
    columnNames.has("include_session_directory") ||
    columnNames.has("include_os_info");
  if (!hasAny) return;

  const legacyFlag = (name: string) =>
    columnNames.has(name) ? name : `0 AS ${name}`;

  const rows = db
    .query(
      `SELECT id, system_prompt,
        ${legacyFlag("include_personalization")},
        ${legacyFlag("include_session_directory")},
        ${legacyFlag("include_os_info")}
      FROM agents`,
    )
    .all() as Array<{
    id: string;
    system_prompt: string;
    include_personalization: number | null;
    include_session_directory: number | null;
    include_os_info: number | null;
  }>;

  const update = db.prepare("UPDATE agents SET system_prompt = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const r of rows) {
      const parts: string[] = [r.system_prompt ?? ""];
      const has = (tok: string) => parts[0]!.includes(tok);
      if (r.include_personalization && !has("{{PERSONALIZATION}}")) {
        parts.push("{{PERSONALIZATION}}");
      }
      if (r.include_session_directory && !has("{{SESSION_DIRECTORY}}")) {
        parts.push("{{SESSION_DIRECTORY}}");
      }
      if (r.include_os_info && !has("{{OS}}")) {
        parts.push("{{OS}}");
      }
      if (parts.length > 1) {
        update.run(parts.filter((s) => s.length > 0).join("\n\n"), r.id);
      }
    }
  });
  tx();

  if (columnNames.has("include_personalization")) {
    db.run("ALTER TABLE agents DROP COLUMN include_personalization");
  }
  if (columnNames.has("include_session_directory")) {
    db.run("ALTER TABLE agents DROP COLUMN include_session_directory");
  }
  if (columnNames.has("include_os_info")) {
    db.run("ALTER TABLE agents DROP COLUMN include_os_info");
  }
}

export function migrateOpenRouterCatalog(db: Database) {
  db.transaction(() => {
    const columns = db.query("PRAGMA table_info(openrouter_models)").all() as {
      name: string;
    }[];
    // The old schema is the one-time migration marker. Never reset the new table.
    if (
      columns.length &&
      !columns.some((column) => column.name === "enabled")
    ) {
      db.run("DROP TABLE openrouter_models");
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS openrouter_publishers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subscribed INTEGER NOT NULL DEFAULT 0 CHECK (subscribed IN (0, 1)),
        subscribed_at INTEGER,
        CHECK (subscribed = 0 OR subscribed_at IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS openrouter_models (
        route TEXT PRIMARY KEY,
        publisher_id TEXT NOT NULL REFERENCES openrouter_publishers(id),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        catalog_created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_openrouter_models_publisher_enabled
        ON openrouter_models(publisher_id, enabled);
      CREATE TABLE IF NOT EXISTS model_favorites (
        provider TEXT NOT NULL CHECK (provider IN ('openrouter', 'ollama')),
        model_id TEXT NOT NULL,
        PRIMARY KEY (provider, model_id)
      );
    `);
    const publisherColumns = db
      .query("PRAGMA table_info(openrouter_publishers)")
      .all() as { name: string }[];
    if (!publisherColumns.some((column) => column.name === "tracked")) {
      db.run(
        "ALTER TABLE openrouter_publishers ADD COLUMN tracked INTEGER NOT NULL DEFAULT 1 CHECK (tracked IN (0, 1))",
      );
    }
    if (tableExists(db, "app_settings")) {
      db.run(
        "DELETE FROM app_settings WHERE key IN ('openrouter_models_seeded_v1', 'openrouter_models_seeded_v2', 'openrouter_models_seeded_v3')",
      );
    }
    const insert = db.prepare(
      "INSERT OR IGNORE INTO openrouter_publishers (id, name) VALUES (?, ?)",
    );
    for (const publisher of POPULAR_PUBLISHERS)
      insert.run(publisher.id, publisher.name);
  })();
}

/** Upgrade existing editing tools once, preserving subsequent user choices. */
export function migrateFileEditingTools(db: Database) {
  if (!tableExists(db, "agent_tools") || !tableExists(db, "app_settings"))
    return;
  if (
    db
      .query("SELECT 1 FROM app_settings WHERE key = 'file_editing_tools_v1'")
      .get()
  )
    return;
  db.transaction(() => {
    db.run(`INSERT OR IGNORE INTO agent_tools (agent_id, tool_name, position)
      SELECT agent_id, 'apply_patch', MAX(position) + 1 FROM agent_tools
      GROUP BY agent_id HAVING SUM(tool_name IN ('create_file', 'bash')) > 0`);
    db.run(
      "INSERT INTO app_settings (key, value) VALUES ('file_editing_tools_v1', '1')",
    );
  })();
}

export function runMigrations(db: Database) {
  migrateOpenRouterCatalog(db);
  migrateSessionsAgentColumn(db);
  migrateSessionsDirectoryColumn(db);
  migrateSessionsWorkspaceKindColumn(db);
  migrateAgentsInlinePlaceholders(db);
  migrateSessionsOwnerColumn(db);
  migrateAgentsOwnerColumn(db);
  migrateAgentSkills(db);
  migrateFileEditingTools(db);
  migrateAgentDelegations(db);
  migrateSeededComputerAgentName(db);
  migrateMessagesAttachmentsColumn(db);
  if (tableExists(db, "messages")) migrateAttachmentMetadata(db);
}
