import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  type CallToolResult,
  CallToolResultSchema,
  type Tool as McpToolDefinition,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "ollama";
import type { RunContext } from "../RunContext";
import { BaseTool, type ToolResult } from "./BaseTool";

/** Provider function names allow 64 characters from `[A-Za-z0-9_-]`. */
export function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(
    0,
    64,
  );
}

function contentText(block: CallToolResult["content"][number]): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "resource":
      return "text" in block.resource
        ? block.resource.text
        : `[binary resource: ${block.resource.uri}]`;
    case "resource_link":
      return `[resource: ${block.uri}]`;
    default:
      return `[${block.type} content omitted]`;
  }
}

/** A tool on a user's MCP server, called through an open connection. */
export class McpTool extends BaseTool {
  constructor(
    private readonly client: Client,
    serverName: string,
    private readonly definition: McpToolDefinition,
  ) {
    super(
      mcpToolName(serverName, definition.name),
      definition.description ?? definition.title ?? definition.name,
    );
  }

  override toTool(): Tool {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.definition.inputSchema,
      },
    };
  }

  override async execute(
    args: Record<string, unknown>,
    ctx?: RunContext,
  ): Promise<ToolResult> {
    // The SDK's return type also covers a legacy result shape; narrow it.
    const result = CallToolResultSchema.parse(
      await this.client.callTool(
        { name: this.definition.name, arguments: args },
        undefined,
        { signal: ctx?.signal },
      ),
    );
    const text =
      result.content.map(contentText).join("\n\n") ||
      JSON.stringify(result.structuredContent ?? {});
    return { text, failed: result.isError === true };
  }
}
