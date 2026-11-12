import type { ServiceImpl } from "@connectrpc/connect";
import { isUniqueViolation } from "../db/errors";
import {
  type McpServerRow,
  createMcpServers,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  setMcpServerEnabled,
} from "../db/mcpServers";
import {
  McpServerOAuth_GrantType,
  type McpServerService,
} from "../gen/euler/v1/mcp_pb";
import { connectMcpServer } from "../mcp/client";
import { safeMcpIcons } from "../mcp/icons";
import {
  disconnectMcpServerOAuth,
  finishMcpServerOAuth,
  isMcpAuthorizationRequired,
  startMcpServerOAuth,
} from "../mcp/oauth";
import { openUserMcpTools } from "../mcp/userTools";
import { OperationError } from "../observability/errors";
import { McpConfigSchema } from "../schemas/mcp";
import { McpTool } from "../tools/mcp";
import { errorMessage } from "../utils/errors";
import { ownerOf } from "./context";
import { icon, millis } from "./wire";

const notFound = () =>
  new OperationError("NOT_FOUND", { message: "MCP server not found" });

/** Header values and OAuth secrets stay on the server. */
function server(row: McpServerRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    headerNames: Object.keys(row.headers),
    enabled: row.enabled,
    createdAt: millis(row.created_at),
    updatedAt: millis(row.updated_at),
    ...(row.oauthConfig || row.oauthConnected
      ? {
          oauth: {
            connected: row.oauthConnected,
            configured: row.oauthConfig !== null,
            grantType:
              row.oauthConfig?.grantType === "client_credentials"
                ? McpServerOAuth_GrantType.CLIENT_CREDENTIALS
                : McpServerOAuth_GrantType.AUTHORIZATION_CODE,
            ...(row.oauthConfig?.clientId
              ? { clientId: row.oauthConfig.clientId }
              : {}),
            hasClientSecret: Boolean(row.oauthConfig?.clientSecret),
            scopes: row.oauthScopes,
          },
        }
      : {}),
  };
}

function parseConfig(text: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new OperationError("INVALID_REQUEST", {
      message: "Paste a JSON config with an mcpServers object",
    });
  }
  const parsed = McpConfigSchema.safeParse(json);
  if (!parsed.success)
    throw new OperationError("INVALID_REQUEST", {
      message: parsed.error.issues[0]?.message,
    });
  return parsed.data;
}

export const mcpServerService: ServiceImpl<typeof McpServerService> = {
  listServers(_request, context) {
    return { servers: listMcpServers(ownerOf(context)).map(server) };
  },
  async listTools(_request, context) {
    const set = await openUserMcpTools(ownerOf(context), context.signal);
    try {
      return {
        tools: set.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          icons: tool.icons.map(icon),
        })),
      };
    } finally {
      await set.close();
    }
  },
  createServers(request, context) {
    const owner = ownerOf(context);
    const config = parseConfig(request.config);
    try {
      return { servers: createMcpServers(owner, config).map(server) };
    } catch (error) {
      if (isUniqueViolation(error))
        throw new OperationError("CONFLICT", {
          message: "An MCP server with that name already exists",
        });
      throw error;
    }
  },
  updateServer(request, context) {
    const row = setMcpServerEnabled(
      ownerOf(context),
      request.id,
      request.enabled,
    );
    if (!row) throw notFound();
    return { server: server(row) };
  },
  deleteServer(request, context) {
    if (!deleteMcpServer(ownerOf(context), request.id)) throw notFound();
    return {};
  },
  async testServer(request, context) {
    const row = getMcpServer(ownerOf(context), request.id);
    if (!row) throw notFound();
    try {
      const { client, tools } = await connectMcpServer(row, context.signal);
      try {
        return {
          result: {
            case: "connected",
            value: {
              icons: safeMcpIcons(
                client.getServerVersion()?.icons ?? [],
                row.url,
              ).map(icon),
              tools: tools.map((definition) => ({
                name: definition.name,
                description: definition.description ?? "",
                icons: new McpTool(
                  client,
                  row.name,
                  definition,
                  row.url,
                ).icons.map(icon),
              })),
            },
          },
          authorizationRequired: false,
        };
      } finally {
        await client.close();
      }
    } catch (error) {
      const authorizationRequired = isMcpAuthorizationRequired(row, error);
      return {
        result: {
          case: "error",
          value: authorizationRequired
            ? "Authorization required"
            : errorMessage(error),
        },
        authorizationRequired,
      };
    }
  },
  async startServerOAuth(request, context) {
    const started = await startMcpServerOAuth(
      ownerOf(context),
      request.id,
      request.redirectOrigin,
      context.signal,
    );
    return {
      authorizationUrl: started.authorizationUrl,
      redirectUri: started.redirectUri,
      server: server(started.server),
    };
  },
  async finishServerOAuth(request, context) {
    const updated = await finishMcpServerOAuth(
      ownerOf(context),
      request.id,
      request.callbackUrl,
      context.signal,
    );
    return { server: server(updated) };
  },
  async disconnectServerOAuth(request, context) {
    const disconnected = await disconnectMcpServerOAuth(
      ownerOf(context),
      request.id,
      context.signal,
    );
    return {
      server: server(disconnected.server),
      revoked: disconnected.revoked,
    };
  },
};
