import type { Tool } from "ollama";
import type { RunContext, Step } from "../RunContext";
import { agentManager } from "../agents/agentManager";
import { BaseTool, type ToolResult, textToolResult } from "./BaseTool";

export class RunSubagentTool extends BaseTool {
  constructor() {
    super(
      "run_subagent",
      "Run a subagent with your tools and instructions in a fresh context, and receive its final response. Use it for self-contained work that would otherwise fill your context, such as broad searches or reading many files. The subagent cannot see this conversation, so include all relevant context, file paths, and exact success criteria in the task.",
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
          properties: {
            task: {
              type: "string",
              description:
                "The overall task to perform. Ensure this is a simple text prompt. If you have long code snippets, use task_lines instead.",
            },
            task_lines: {
              type: "array",
              items: { type: "string" },
              description:
                "The overall task to perform, split into an array of strings. Use this instead of 'task' if your prompt contains multiple lines or code.",
            },
          },
          required: [],
        },
      },
    };
  }

  override async execute(
    args: Record<string, unknown>,
    ctx?: RunContext,
    parentToolStep?: Step,
  ): Promise<ToolResult> {
    const task =
      typeof args.task === "string"
        ? args.task
        : Array.isArray(args.task_lines)
          ? args.task_lines.join("\n")
          : "";
    if (!task)
      return textToolResult("Error: you must provide a task or task_lines");

    if (!ctx || !parentToolStep) {
      return textToolResult("Error: missing context for sub-agent invocation");
    }
    const agent = agentManager.createSubagentForContext(ctx, task);
    const childCtx = ctx.createChild(agent, task, parentToolStep);
    return textToolResult(await agent.run(task, childCtx));
  }
}
