import { agentRuntime } from "../agents/runtime/AgentRuntime";
import type { FeatureTools } from "../features/Feature";
import {
  activeFeatures,
  featureIds,
  openFeatureTools,
} from "../features/index";
import type { DisplayIcon } from "../schemas/icons";
import { toolDefinition } from "../tools/background";
import { mergeToolFields } from "./toolFieldMetadata";
import { toolFields } from "./toolFields";

/** Current definitions, including user-scoped MCP names exactly as agents invoke them. */
export async function toolCatalog(ownerUuid: string, signal: AbortSignal) {
  const features = await activeFeatures(ownerUuid);
  const active = featureIds(features);
  const open = (
    agentKind: "main" | "general",
    from = features,
  ): Promise<FeatureTools> =>
    openFeatureTools(from, {
      ownerUuid,
      agentKind,
      active,
      signal,
      host: agentRuntime.catalogHost(ownerUuid, agentKind),
    });
  const main = await open("main");
  try {
    const tools = new Map<
      string,
      {
        name: string;
        description: string;
        fields: ReturnType<typeof toolFields>;
        icons?: readonly DisplayIcon[];
      }
    >();
    // A server's tools are the same for a subagent; connect to it only once.
    const general = await open(
      "general",
      features.filter((feature) => feature.id !== "mcp"),
    );
    for (const tool of [...main.tools, ...general.tools]) {
      const { description, parameters } = toolDefinition(tool).function;
      const { name } = tool;
      const fields = toolFields(parameters);
      const previous = tools.get(name);
      if (!previous) {
        tools.set(name, {
          name,
          description: description ?? tool.description,
          fields,
          ...(tool.icons.length ? { icons: tool.icons } : {}),
        });
        continue;
      }
      // Main agents and subagents share names but can declare different fields or enums.
      previous.fields = mergeToolFields([...previous.fields, ...fields]);
    }
    return [...tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await main.close?.();
  }
}
