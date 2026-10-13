import type { Tool } from "ollama";
import { z } from "zod";
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

const CreateFileArgs = FilePathArgs.extend({
  content: z.string().optional(),
  lines: z.array(z.string()).optional(),
});

export class CreateFileTool extends BaseTool {
  constructor() {
    super("create_file", "Create a file, creating missing parent directories");
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
            content: {
              type: "string",
              description:
                "File contents (use lines array instead if content is multiline)",
            },
            lines: {
              type: "array",
              items: { type: "string" },
              description:
                "File contents as an array of strings. RECOMMENDED over content if your code contains newlines.",
            },
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
      const { path, content, lines } = parseToolArgs(CreateFileArgs, args);
      const workspace = requireWorkspace(ctx);
      await workspaceService.writeFile(
        workspace,
        path,
        content ?? lines?.join("\n") ?? "",
      );
      ctx?.writtenFiles.add(path);
      return textToolResult(`File created at ${path}`);
    } catch (error) {
      return textToolResult(workspaceError(error));
    }
  }
}
