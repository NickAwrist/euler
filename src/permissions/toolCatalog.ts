import { agentManager } from "../agents/agentManager";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { openUserMcpTools } from "../mcp/userTools";

/** Current definitions, including user-scoped MCP names exactly as agents invoke them. */
export async function toolCatalog(ownerUuid: string, signal: AbortSignal) {
  const options = { ownerUuid };
  const builtins = [
    ...agentManager.createAgent(options).tools,
    ...agentManager.createGeneralAgent(options).tools,
    ...agentRuntime.toolCatalog(ownerUuid),
  ];
  const mcp = await openUserMcpTools(ownerUuid, signal);
  try {
    const tools = new Map(
      [...builtins, ...mcp.tools].map(({ name, description }) => [
        name,
        { name, description },
      ]),
    );
    return [...tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await mcp.close();
  }
}
