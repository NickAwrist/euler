import type { Tool } from "ollama";
import type { RunContext } from "../RunContext";
import { workspaceService } from "../workspaces/WorkspaceService";
import {
  BaseTool,
  type ToolResult,
  parseToolArgs,
  textToolResult,
} from "./BaseTool";
import {
  FILE_PATH_PARAMETER,
  FilePathArgs,
  requireWorkspace,
  workspaceError,
} from "./workspace";

export class DeleteFileTool extends BaseTool {
  constructor() {
    super("delete_file", "Delete a file");
  }

  override toTool(): Tool {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          required: ["path"],
          properties: {
            path: FILE_PATH_PARAMETER,
          },
        },
      },
    };
  }

  override async execute(
    args: Record<string, unknown>,
    ctx?: RunContext,
  ): Promise<ToolResult> {
    try {
      const { path } = parseToolArgs(FilePathArgs, args);
      await workspaceService.deleteFile(requireWorkspace(ctx), path);
      return textToolResult(`File deleted at ${path}`);
    } catch (e) {
      return textToolResult(workspaceError(e));
    }
  }
}
