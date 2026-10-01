import type { Tool } from "ollama";
import type { RunContext, Step } from "../RunContext";
import type {
  ToolContent,
  ToolContentUpdate,
  ToolInput,
} from "../schemas/toolContent";
import type { Workspace } from "../workspaces/WorkspaceService";
import type { BaseTool, ToolResult } from "./BaseTool";

export interface JobContext {
  workspace: Workspace;
  signal: AbortSignal;
  background: boolean;
  emitProgress(update: ToolContentUpdate): void;
  emitOutput(update: ToolContentUpdate): void;
}
export type BackgroundResult = ToolResult & {
  output?: ToolContent;
  metadata?: ToolContent;
};
export interface RunningExecution {
  completion: Promise<BackgroundResult>;
  cancel(): Promise<void>;
}
export interface BackgroundCapable extends BaseTool {
  describeInput(args: Record<string, unknown>): ToolInput;
  start(
    args: Record<string, unknown>,
    ctx: JobContext,
  ): Promise<RunningExecution>;
}
export function isBackgroundCapable(tool: BaseTool): tool is BackgroundCapable {
  return (
    "start" in tool &&
    typeof tool.start === "function" &&
    "describeInput" in tool &&
    typeof tool.describeInput === "function"
  );
}
export interface JobExecutor {
  start(
    tool: BackgroundCapable,
    args: Record<string, unknown>,
    ctx: RunContext,
    step?: Step,
  ): Promise<ToolResult>;
}
export function toolDefinition(tool: BaseTool): Tool {
  const definition = tool.toTool();
  if (isBackgroundCapable(tool)) {
    const parameters = definition.function.parameters;
    definition.function.parameters = {
      ...parameters,
      type: "object",
      properties: {
        ...parameters?.properties,
        background: {
          type: "boolean",
          description:
            "Return a job handle immediately. Completion arrives as a runtime message. Defaults to false.",
        },
      },
    };
  }
  return definition;
}
