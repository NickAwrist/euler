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
  prompt: z.string().trim().min(1),
  wait: z.boolean().optional(),
});
export type SpawnRequest = z.infer<typeof SpawnAgentArgs>;
export type SpawnResult = {
  agentId: string;
  status?: string;
  result?: string;
  error?: string;
};

export class SpawnAgentTool extends BaseTool {
  constructor(private spawn: (request: SpawnRequest) => Promise<SpawnResult>) {
    super(
      "spawn_agent",
      "Create a reusable general subagent with an initial prompt. Include the context it needs. It keeps its identity and conversation history: use send_message for follow-ups or different work. After a server restart it remains available but does not resume automatically. Dismiss it with cancel_agent when no longer needed.",
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
          required: ["kind", "title", "prompt"],
          properties: {
            kind: { type: "string", enum: ["general"] },
            title: { type: "string" },
            prompt: { type: "string" },
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
