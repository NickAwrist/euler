import { listMcpServers } from "../db/mcpServers";
import { openUserMcpTools } from "../mcp/userTools";
import { Feature, type FeatureRun, type FeatureTools } from "./Feature";

/** On whenever the user has an enabled server; there is no switch. */
export class McpFeature extends Feature {
  readonly id = "mcp";
  readonly label = "MCP servers";
  readonly description = "Tools from the remote MCP servers you add.";
  // Servers name their own tools, so none can be listed here.
  readonly toolNames = [];

  enabled(ownerUuid: string): boolean {
    return listMcpServers(ownerUuid).some((server) => server.enabled);
  }

  override tools(run: FeatureRun): Promise<FeatureTools> {
    return openUserMcpTools(run.ownerUuid, run.signal);
  }
}
