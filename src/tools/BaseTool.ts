import type { Tool } from "ollama";
import { z } from "zod";
import type { RunContext, Step } from "../RunContext";
import type { ToolOutputAttachment } from "../attachments/types";

export type ToolResult = {
  text: string;
  endActivation?: boolean;
  /** Shown with the assistant reply so display does not depend on the model repeating it. */
  attachments?: ToolOutputAttachment[];
};

export function textToolResult(text: string): ToolResult {
  return { text };
}

/** Validates tool arguments; the error names each invalid field for the model. */
export function parseToolArgs<T extends z.ZodType>(
  schema: T,
  args: Record<string, unknown>,
): z.infer<T> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

export class BaseTool {
  name: string;
  description: string;

  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  async execute(
    args: Record<string, unknown>,
    _ctx?: RunContext,
    _parentToolStep?: Step,
  ): Promise<ToolResult> {
    throw new Error("Tool not implemented");
  }

  toTool(): Tool {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
      },
    };
  }
}
