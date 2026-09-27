import type { Tool } from "ollama";
import { z } from "zod";
import {
  BaseTool,
  type ToolResult,
  parseToolArgs,
  textToolResult,
} from "./BaseTool";

const SpawnAgentArgs = z.object({
  kind: z.literal("general"),
  title: z.string().trim().min(1),
  task: z.string().trim().min(1),
  wait: z.boolean().optional(),
});
export type SpawnRequest = z.infer<typeof SpawnAgentArgs>;
export type SpawnResult = { agentId: string; status?: string; result?: string };

export class SpawnAgentTool extends BaseTool {
  constructor(private spawn: (request: SpawnRequest) => Promise<SpawnResult>) {
    super(
      "spawn_agent",
      "Start a durable general subagent. Include context and success criteria. It reports back when done, then stays ready: send_message wakes it with a follow-up and it keeps its context. Dismiss it with cancel_agent when it is no longer needed.",
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
          required: ["kind", "title", "task"],
          properties: {
            kind: { type: "string", enum: ["general"] },
            title: { type: "string" },
            task: { type: "string" },
            wait: { type: "boolean" },
          },
        },
      },
    };
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    return textToolResult(
      JSON.stringify(await this.spawn(parseToolArgs(SpawnAgentArgs, args))),
    );
  }
}
