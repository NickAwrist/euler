import type { Tool } from "ollama";
import { z } from "zod";
import { BaseTool, type ToolResult, parseToolArgs } from "./BaseTool";

const AskParentArgs = z.object({ question: z.string().trim().min(1) });

export class AskParentTool extends BaseTool {
  constructor(private ask: (question: string) => void) {
    super("ask_parent", "Ask the parent a question and wait for its answer.");
  }

  override toTool(): Tool {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          required: ["question"],
          properties: { question: { type: "string" } },
        },
      },
    };
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    this.ask(parseToolArgs(AskParentArgs, args).question);
    return { text: "Waiting for parent", endActivation: true };
  }
}
