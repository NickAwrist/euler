import type { Tool } from "ollama";
import { z } from "zod";
import {
  BaseTool,
  type ToolResult,
  parseToolArgs,
  textToolResult,
} from "./BaseTool";

const CancelAgentArgs = z.object({
  agentId: z.string().min(1),
  reason: z.string().trim().min(1),
});

export class CancelAgentTool extends BaseTool {
  constructor(
    private cancel: (agentId: string, reason: string) => Promise<void>,
  ) {
    super(
      "cancel_agent",
      "Stop a working subagent, or dismiss a ready one you no longer need.",
    );
  }

  override toTool(): Tool {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          required: ["agentId", "reason"],
          properties: {
            agentId: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    };
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { agentId, reason } = parseToolArgs(CancelAgentArgs, args);
    await this.cancel(agentId, reason);
    return textToolResult("Cancelled");
  }
}
