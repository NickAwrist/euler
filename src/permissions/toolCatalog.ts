import { agentManager } from "../agents/agentManager";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { openUserMcpTools } from "../mcp/userTools";
import { toolDefinition } from "../tools/background";
import { mergeToolFields } from "./toolFieldMetadata";
import { toolFields } from "./toolFields";

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
    const tools = new Map<
      string,
      {
        name: string;
        description: string;
        fields: ReturnType<typeof toolFields>;
      }
    >();
    for (const tool of [...builtins, ...mcp.tools]) {
      const { description, parameters } = toolDefinition(tool).function;
      const { name } = tool;
      const fields = toolFields(parameters);
      const previous = tools.get(name);
      if (!previous) {
        tools.set(name, {
          name,
          description: description ?? tool.description,
          fields,
        });
        continue;
      }
      // Main agents and subagents share names but can declare different fields or enums.
      previous.fields = mergeToolFields([...previous.fields, ...fields]);
    }
    return [...tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await mcp.close();
  }
}
