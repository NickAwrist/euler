import type { Tool } from "ollama";
import type { RunContext } from "../RunContext";
import { workspaceService } from "../workspaces/WorkspaceService";
import { BaseTool, type ToolResult, textToolResult } from "./BaseTool";
import { requireWorkspace, workspaceError } from "./workspace";

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
            path: {
              type: "string",
              description:
                "File path (relative to /workspace or absolute under /workspace)",
            },
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
    const rawPath =
      typeof args.path === "string" && args.path.length > 0
        ? args.path
        : typeof args.filename === "string" && args.filename.length > 0
          ? args.filename
          : "";
    if (!rawPath) {
      return textToolResult("Error: missing path (provide path or filename)");
    }
    const content =
      typeof args.content === "string"
        ? args.content
        : Array.isArray(args.lines)
          ? args.lines.join("\n")
          : "";
    try {
      const workspace = requireWorkspace(ctx);
      await workspaceService.writeFile(workspace, rawPath, content);
      ctx?.writtenFiles.add(rawPath);
      return textToolResult(`File created at ${rawPath}`);
    } catch (error) {
      return textToolResult(workspaceError(error));
    }
  }
}
