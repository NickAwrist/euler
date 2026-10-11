import crypto from "node:crypto";
import type { McpServerWrite } from "../schemas/mcp";
import { getDb } from "./connection";

export type McpServerRow = McpServerWrite & {
  id: string;
  owner_uuid: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

type StoredMcpServerRow = Omit<McpServerRow, "headers" | "enabled"> & {
  headers: string;
  enabled: number;
};

const MCP_SERVER_COLUMNS =
  "id, owner_uuid, name, url, headers, enabled, created_at, updated_at";

function toMcpServerRow(row: StoredMcpServerRow): McpServerRow {
  return {
    ...row,
    headers: JSON.parse(row.headers) as Record<string, string>,
    enabled: row.enabled === 1,
  };
}

export function listMcpServers(ownerUuid: string): McpServerRow[] {
  return (
    getDb()
      .query(
        `SELECT ${MCP_SERVER_COLUMNS} FROM mcp_servers WHERE owner_uuid = ? ORDER BY created_at ASC, name ASC`,
      )
      .all(ownerUuid) as StoredMcpServerRow[]
  ).map(toMcpServerRow);
}

export function getMcpServer(
  ownerUuid: string,
  id: string,
): McpServerRow | null {
  const row = getDb()
    .query(
      `SELECT ${MCP_SERVER_COLUMNS} FROM mcp_servers WHERE owner_uuid = ? AND id = ?`,
    )
    .get(ownerUuid, id) as StoredMcpServerRow | null;
  return row && toMcpServerRow(row);
}

/** Adds all servers or none, so a pasted config never half-applies. */
export function createMcpServers(
  ownerUuid: string,
  servers: McpServerWrite[],
): McpServerRow[] {
  const now = Date.now();
  const rows = servers.map(
    (server): McpServerRow => ({
      id: crypto.randomUUID(),
      owner_uuid: ownerUuid,
      ...server,
      enabled: true,
      created_at: now,
      updated_at: now,
    }),
  );
  const db = getDb();
  db.transaction(() => {
    for (const row of rows) {
      db.run(
        `INSERT INTO mcp_servers (${MCP_SERVER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          ownerUuid,
          row.name,
          row.url,
          JSON.stringify(row.headers),
          1,
          now,
          now,
        ],
      );
    }
  })();
  return rows;
}

export function setMcpServerEnabled(
  ownerUuid: string,
  id: string,
  enabled: boolean,
): McpServerRow | null {
  const result = getDb().run(
    "UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE owner_uuid = ? AND id = ?",
    [Number(enabled), Date.now(), ownerUuid, id],
  );
  return result.changes === 0 ? null : getMcpServer(ownerUuid, id);
}

export function deleteMcpServer(ownerUuid: string, id: string): boolean {
  return (
    getDb().run("DELETE FROM mcp_servers WHERE owner_uuid = ? AND id = ?", [
      ownerUuid,
      id,
    ]).changes > 0
  );
}
