import { AskParentTool } from "../tools/ask_parent";
import { CancelAgentTool } from "../tools/cancel_agent";
import { SendMessageTool } from "../tools/send_message";
import { SpawnAgentTool } from "../tools/spawn_agent";
import {
  CAPABLE,
  type Capability,
  type FeatureRun,
  type FeatureTools,
  ToggleFeature,
} from "./Feature";

export class SubagentsFeature extends ToggleFeature {
  readonly id = "subagents";
  readonly label = "Subagents";
  readonly description = "Hand work to subagents that run in the background.";
  readonly toolNames = [
    "spawn_agent",
    "cancel_agent",
    "send_message",
    "ask_parent",
  ];
  override readonly sidebarTab = "Agents";

  async capable(): Promise<Capability> {
    return CAPABLE;
  }

  override async tools({ agentKind, host }: FeatureRun): Promise<FeatureTools> {
    if (agentKind !== "main")
      return {
        tools: [
          new SendMessageTool(host.sendMessage, true),
          new AskParentTool(host.askParent),
        ],
      };
    return {
      tools: [
        new SendMessageTool(host.sendMessage, false),
        new SpawnAgentTool(host.spawn),
        new CancelAgentTool(host.cancelAgent),
      ],
    };
  }
}
