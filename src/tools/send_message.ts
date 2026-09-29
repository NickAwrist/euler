import type { Tool } from "ollama";
import { z } from "zod";
import {
  BaseTool,
  type ToolResult,
  parseToolArgs,
  textToolResult,
} from "./BaseTool";

const ToSubagentArgs = z.object({
  to: z.string().min(1),
  content: z.string().trim().min(1),
});
const ToParentArgs = z.object({
  content: z.string().trim().min(1),
  kind: z.literal("progress").optional(),
});
export type AgentMessageRequest = {
  to?: string;
  content: string;
  kind?: "progress";
};

/**
 * A main agent messages one of its subagents, which wakes it. A subagent
 * messages its parent and may mark a message as progress, which does not.
 */
export class SendMessageTool extends BaseTool {
  constructor(
    private send: (request: AgentMessageRequest) => void,
    private toParent: boolean,
  ) {
    super(
      "send_message",
      toParent
        ? "Send a message to your parent. Progress does not wake the parent."
        : "Send a message to one of your subagents. It wakes the subagent.",
    );
  }

  override toTool(): Tool {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.toParent
          ? {
              type: "object",
              required: ["content"],
              properties: {
                content: { type: "string" },
                kind: { type: "string", enum: ["progress"] },
              },
            }
          : {
              type: "object",
              required: ["to", "content"],
              properties: {
                to: { type: "string", description: "The subagent's ID." },
                content: { type: "string" },
              },
            },
      },
    };
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    this.send(
      parseToolArgs(this.toParent ? ToParentArgs : ToSubagentArgs, args),
    );
    return textToolResult("Message sent");
  }
}
