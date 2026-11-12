import crypto from "node:crypto";
import type { z } from "zod";
import {
  type McpOAuthConfig,
  McpOAuthConfigSchema,
  type McpServerWrite,
  StoredMcpClientInfoSchema,
  StoredMcpDiscoveryStateSchema,
  StoredMcpHeadersSchema,
  StoredMcpTokensSchema,
} from "../schemas/mcp";
import { getDb } from "./connection";

export type McpServerRow = Omit<McpServerWrite, "oauth"> & {
  id: string;
  owner_uuid: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
  oauthConfig: McpOAuthConfig | null;
  oauthConnected: boolean;
  oauthScopes: string[];
};

export type McpServerOAuthRecord = {
  config: McpOAuthConfig | null;
  clientInfo: z.output<typeof StoredMcpClientInfoSchema> | null;
  tokens: z.output<typeof StoredMcpTokensSchema> | null;
  discoveryState: z.output<typeof StoredMcpDiscoveryStateSchema> | null;
  expiresAt: number | null;
};

type JoinedMcpServerRow = {
  id: string;
  owner_uuid: string;
  name: string;
  url: string;
  headers: string;
  enabled: number;
  created_at: number;
  updated_at: number;
  oauth_config: string | null;
  oauth_tokens: string | null;
};

type StoredMcpOAuthRow = {
  config: string | null;
  client_info: string | null;
  tokens: string | null;
  discovery_state: string | null;
  expires_at: number | null;
};

const MCP_SERVER_SELECT = `
  SELECT
    s.id,
    s.owner_uuid,
    s.name,
    s.url,
    s.headers,
    s.enabled,
    s.created_at,
    s.updated_at,
    o.config AS oauth_config,
    o.tokens AS oauth_tokens
  FROM mcp_servers s
  LEFT JOIN mcp_server_oauth o
    ON o.server_id = s.id AND o.owner_uuid = s.owner_uuid`;

function parseJson<T>(raw: string | null, schema: z.ZodType<T>): T | null {
  if (!raw) return null;
  const parsed = schema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

function toMcpServerRow(row: JoinedMcpServerRow): McpServerRow {
  const oauthConfig = parseJson(row.oauth_config, McpOAuthConfigSchema);
  const tokens = parseJson(row.oauth_tokens, StoredMcpTokensSchema);
  const tokenScopes = tokens?.scope?.split(/\s+/).filter(Boolean);
  return {
    id: row.id,
    owner_uuid: row.owner_uuid,
    name: row.name,
    url: row.url,
    headers: StoredMcpHeadersSchema.parse(JSON.parse(row.headers)),
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    oauthConfig,
    oauthConnected: tokens !== null,
    oauthScopes: tokenScopes ?? oauthConfig?.scopes ?? [],
  };
}

export function listMcpServers(ownerUuid: string): McpServerRow[] {
  return (
    getDb()
      .query(
        `${MCP_SERVER_SELECT} WHERE s.owner_uuid = ? ORDER BY s.created_at ASC, s.name ASC`,
      )
      .all(ownerUuid) as JoinedMcpServerRow[]
  ).map(toMcpServerRow);
}

export function getMcpServer(
  ownerUuid: string,
  id: string,
): McpServerRow | null {
  const row = getDb()
    .query(`${MCP_SERVER_SELECT} WHERE s.owner_uuid = ? AND s.id = ?`)
    .get(ownerUuid, id) as JoinedMcpServerRow | null;
  return row && toMcpServerRow(row);
}

/** Adds all servers or none, so a pasted config never half-applies. */
export function createMcpServers(
  ownerUuid: string,
  servers: McpServerWrite[],
): McpServerRow[] {
  const now = Date.now();
  const rows = servers.map(
    ({ oauth, ...server }): McpServerRow => ({
      id: crypto.randomUUID(),
      owner_uuid: ownerUuid,
      ...server,
      enabled: true,
      created_at: now,
      updated_at: now,
      oauthConfig: oauth ?? null,
      oauthConnected: false,
      oauthScopes: oauth?.scopes ?? [],
    }),
  );
  const db = getDb();
  db.transaction(() => {
    for (const row of rows) {
      db.run(
        "INSERT INTO mcp_servers (id, owner_uuid, name, url, headers, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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
      if (row.oauthConfig) {
        db.run(
          "INSERT INTO mcp_server_oauth (server_id, owner_uuid, config, updated_at) VALUES (?, ?, ?, ?)",
          [row.id, ownerUuid, JSON.stringify(row.oauthConfig), now],
        );
      }
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

export function getMcpServerOAuth(
  ownerUuid: string,
  serverId: string,
): McpServerOAuthRecord | null {
  const row = getDb()
    .query(
      "SELECT config, client_info, tokens, discovery_state, expires_at FROM mcp_server_oauth WHERE owner_uuid = ? AND server_id = ?",
    )
    .get(ownerUuid, serverId) as StoredMcpOAuthRow | null;
  if (!row) return null;
  return {
    config: parseJson(row.config, McpOAuthConfigSchema),
    clientInfo: parseJson(row.client_info, StoredMcpClientInfoSchema),
    tokens: parseJson(row.tokens, StoredMcpTokensSchema),
    discoveryState: parseJson(
      row.discovery_state,
      StoredMcpDiscoveryStateSchema,
    ),
    expiresAt: row.expires_at,
  };
}

export function updateMcpServerOAuth(
  ownerUuid: string,
  serverId: string,
  patch: Partial<McpServerOAuthRecord>,
): boolean {
  const db = getDb();
  return db.transaction(() => {
    const exists = db
      .query("SELECT 1 FROM mcp_servers WHERE owner_uuid = ? AND id = ?")
      .get(ownerUuid, serverId);
    if (!exists) return false;
    const current = getMcpServerOAuth(ownerUuid, serverId) ?? {
      config: null,
      clientInfo: null,
      tokens: null,
      discoveryState: null,
      expiresAt: null,
    };
    const next: McpServerOAuthRecord = {
      config: patch.config === undefined ? current.config : patch.config,
      clientInfo:
        patch.clientInfo === undefined ? current.clientInfo : patch.clientInfo,
      tokens: patch.tokens === undefined ? current.tokens : patch.tokens,
      discoveryState:
        patch.discoveryState === undefined
          ? current.discoveryState
          : patch.discoveryState,
      expiresAt:
        patch.expiresAt === undefined ? current.expiresAt : patch.expiresAt,
    };
    const now = Date.now();
    db.run(
      `INSERT INTO mcp_server_oauth (server_id, owner_uuid, config, client_info, tokens, discovery_state, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET
         config = excluded.config,
         client_info = excluded.client_info,
         tokens = excluded.tokens,
         discovery_state = excluded.discovery_state,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
      [
        serverId,
        ownerUuid,
        next.config ? JSON.stringify(next.config) : null,
        next.clientInfo ? JSON.stringify(next.clientInfo) : null,
        next.tokens ? JSON.stringify(next.tokens) : null,
        next.discoveryState ? JSON.stringify(next.discoveryState) : null,
        next.expiresAt,
        now,
      ],
    );
    return true;
  })();
}
