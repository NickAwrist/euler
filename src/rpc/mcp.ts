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
import type { McpServerService } from "../gen/euler/v1/mcp_pb";
import { connectMcpServer } from "../mcp/client";
import { safeMcpIcons } from "../mcp/icons";
import { openUserMcpTools } from "../mcp/userTools";
import { OperationError } from "../observability/errors";
import { McpConfigSchema } from "../schemas/mcp";
import { McpTool } from "../tools/mcp";
import { errorMessage } from "../utils/errors";
import { ownerOf } from "./context";
import { icon, millis } from "./wire";

const notFound = () =>
  new OperationError("NOT_FOUND", { message: "MCP server not found" });

/** Header values hold credentials, so only their names leave the server. */
function server(row: McpServerRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    headerNames: Object.keys(row.headers),
    enabled: row.enabled,
    createdAt: millis(row.created_at),
    updatedAt: millis(row.updated_at),
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
      const { client, tools } = await connectMcpServer(row);
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
        };
      } finally {
        await client.close();
      }
    } catch (error) {
      return { result: { case: "error", value: errorMessage(error) } };
    }
  },
};
