import type { Tool } from "ollama";
import { z } from "zod";
import {
  BaseTool,
  type ToolResult,
  parseToolArgs,
  textToolResult,
} from "./BaseTool";

const SendMessageArgs = z.object({
  to: z.string().optional(),
  content: z.string().trim().min(1),
  kind: z.literal("progress").optional(),
});
export type AgentMessageRequest = z.infer<typeof SendMessageArgs>;

export class SendMessageTool extends BaseTool {
  constructor(private send: (request: AgentMessageRequest) => void) {
    super(
      "send_message",
      "Send a message to your parent or a subagent. Progress does not wake the parent.",
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
          required: ["content"],
          properties: {
            to: { type: "string" },
            content: { type: "string" },
            kind: { type: "string", enum: ["progress"] },
          },
        },
      },
    };
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    this.send(parseToolArgs(SendMessageArgs, args));
    return textToolResult("Message sent");
  }
}
