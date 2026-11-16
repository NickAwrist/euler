import pathModule from "node:path";
import type { Tool } from "ollama";
import type { RunContext } from "../RunContext";
import {
  type Workspace,
  workspaceService,
} from "../workspaces/WorkspaceService";
import { BaseTool, type ToolResult, textToolResult } from "./BaseTool";
import { requireWorkspace, workspaceError } from "./workspace";

const MAX_PATTERN_LEN = 512;
const SEARCH_BUDGET_MS = 2000;
const LINE_CHECK_INTERVAL = 500;

export class GrepTool extends BaseTool {
  constructor() {
    super(
      "grep",
      "Search for a regex pattern in a file or directory. Directory searches exclude .git, node_modules, .cache and gitignored entries.",
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
          required: ["pattern"],
          properties: {
            pattern: {
              type: "string",
              description: "The regex pattern to search for",
            },
            path: {
              type: "string",
              description:
                "The file or directory to search in (relative to /workspace or absolute under /workspace). If not provided, the current directory is used.",
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
    const patternStr = typeof args.pattern === "string" ? args.pattern : "";
    if (!patternStr) {
      return textToolResult("Error: missing pattern");
    }
    if (patternStr.length > MAX_PATTERN_LEN) {
      return textToolResult(
        `Error: pattern exceeds maximum length (${MAX_PATTERN_LEN} characters)`,
      );
    }

    const rawPath =
      typeof args.path === "string" && args.path.length > 0 ? args.path : ".";
    try {
      const workspace = requireWorkspace(ctx);
      const regex = new RegExp(patternStr);

      const results = await this.searchRecursive(workspace, rawPath, regex);

      if (results.length === 0) {
        return textToolResult("No matches found.");
      }

      return textToolResult(
        results.join("\n").replaceAll(workspace.hostPath, "/workspace"),
      );
    } catch (e) {
      return textToolResult(workspaceError(e));
    }
  }

  private async searchFile(
    workspace: Workspace,
    filePath: string,
    regex: RegExp,
    budget: { deadline: number },
  ): Promise<string[]> {
    const results: string[] = [];
    const content = await workspaceService.readFile(workspace, filePath);
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (
        index > 0 &&
        index % LINE_CHECK_INTERVAL === 0 &&
        Date.now() > budget.deadline
      ) {
        results.push(
          `[grep: time budget exceeded after ${index} lines in ${filePath}]`,
        );
        return results;
      }
      const line = lines[index] ?? "";
      regex.lastIndex = 0;
      if (regex.test(line)) {
        results.push(`${filePath}:${index + 1}: ${line.trim()}`);
      }
    }
    return results;
  }

  private async searchRecursive(
    workspace: Workspace,
    currentPath: string,
    regex: RegExp,
    budget?: { deadline: number },
  ): Promise<string[]> {
    const b = budget ?? { deadline: Date.now() + SEARCH_BUDGET_MS };
    const results: string[] = [];
    try {
      const stats = await workspaceService.statPath(workspace, currentPath);

      if (stats.isFile()) {
        results.push(
          ...(await this.searchFile(workspace, currentPath, regex, b)),
        );
      } else if (stats.isDirectory()) {
        const entries = await workspaceService.readVisibleDirectory(
          workspace,
          currentPath,
        );

        for (const entry of entries) {
          if (Date.now() > b.deadline) {
            results.push(
              `[grep: time budget exceeded while scanning ${currentPath}]`,
            );
            return results;
          }
          const fullPath = pathModule.join(currentPath, entry.name);

          if (entry.isSymbolicLink()) continue;

          if (entry.isDirectory()) {
            const subResults = await this.searchRecursive(
              workspace,
              fullPath,
              regex,
              b,
            );
            results.push(...subResults);
          } else {
            results.push(
              ...(await this.searchFile(workspace, fullPath, regex, b)),
            );
          }
        }
      }
    } catch (e) {
      results.push(`Error reading ${currentPath}: ${(e as Error).message}`);
    }

    return results;
  }
}
