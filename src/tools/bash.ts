import type { Tool } from "ollama";
import { z } from "zod";
import type { RunContext } from "../RunContext";
import { sandboxRunner } from "../sandbox/SandboxRunner";
import { errorMessage } from "../utils/errors";
import { filterOutputLines } from "../utils/gitignoreFilter";
import { loadWorkspaceIgnore } from "../workspaces/WorkspaceIgnore";
import { workspaceService } from "../workspaces/WorkspaceService";
import {
  BaseTool,
  type ToolResult,
  parseToolArgs,
  textToolResult,
} from "./BaseTool";
import type { JobContext, RunningExecution } from "./background";
import { requireWorkspace } from "./workspace";

const DEFAULT_MAX_BUFFER = 2 * 1024 * 1024;

const BashArgs = z.object({
  command: z.string().min(1),
  outputFiles: z.array(z.string().min(1)).default([]),
});

export class BashTool extends BaseTool {
  constructor() {
    super("bash", "Execute a shell command inside the active workspace.");
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
            outputFiles: {
              type: "array",
              items: { type: "string" },
              description:
                "Paths of files this command creates or modifies to attach to the reply. Only list outputs of this command.",
            },
            command: {
              type: "string",
              description: "The shell command to execute.",
            },
          },
          required: ["command"],
        },
      },
    };
  }

  override async execute(
    args: Record<string, unknown>,
    ctx?: RunContext,
  ): Promise<ToolResult> {
    const command = typeof args.command === "string" ? args.command : "";
    if (!command) return textToolResult("Error: No command provided.");
    if (ctx?.signal?.aborted) return textToolResult("[command aborted]");

    try {
      const { outputFiles } = parseToolArgs(BashArgs, args);
      const workspace = requireWorkspace(ctx);
      const execution = await this.start(args, {
        workspace,
        signal: ctx?.signal ?? new AbortController().signal,
        background: false,
        emitProgress: () => {},
        emitOutput: () => {},
      });
      const result = await execution.completion;
      if (!result.failed)
        for (const path of outputFiles) ctx?.writtenFiles.add(path);
      return result;
    } catch (error) {
      if (ctx?.signal?.aborted) return textToolResult("[command aborted]");
      return textToolResult(`Error executing command: ${errorMessage(error)}`);
    }
  }

  describeInput(args: Record<string, unknown>) {
    const { command } = parseToolArgs(BashArgs, args);
    return {
      summary: command.slice(0, 300),
      content: {
        blocks: [{ kind: "code" as const, language: "bash", text: command }],
      },
    };
  }

  async start(
    args: Record<string, unknown>,
    ctx: JobContext,
  ): Promise<RunningExecution> {
    const { command, outputFiles } = parseToolArgs(BashArgs, args);
    const workspace = ctx.workspace;
    ctx.emitOutput({
      mode: "replace",
      content: { blocks: [{ kind: "code", text: "" }] },
    });
    const execution = await sandboxRunner.spawn({
      command,
      workspace,
      signal: ctx.signal,
      background: ctx.background,
      emitOutput: (chunk) =>
        ctx.emitOutput({
          mode: "append",
          content: {
            blocks: [
              {
                kind: "code",
                text: chunk.text,
              },
            ],
          },
        }),
      maxOutputBytes: DEFAULT_MAX_BUFFER,
    });
    const completion = (async () => {
      const result = await execution.completion;
      let output = "";
      if (result.stdout) {
        const ig = await loadWorkspaceIgnore(workspaceService, workspace, ".");
        const filtered = filterOutputLines(result.stdout, ig, "/workspace");
        output = filtered.filtered;
        if (filtered.removedCount > 0) {
          output += `\n[${filtered.removedCount} ignored entries hidden]`;
        }
      }
      if (result.stderr) output += `\n--- stderr ---\n${result.stderr}`;
      if (result.truncated) {
        output += `\n[output truncated at ${DEFAULT_MAX_BUFFER} bytes]`;
      }
      if (result.exitCode !== 0) {
        output += `\n[command exited with status ${result.exitCode}]`;
      }
      return {
        text: output || "Command executed successfully with no output.",
        failed: result.exitCode !== 0,
        outputFiles: result.exitCode === 0 ? outputFiles : [],
        metadata: {
          blocks: [
            {
              kind: "fields" as const,
              fields: [
                {
                  label: "Exit code",
                  value:
                    result.exitCode === null
                      ? "terminated"
                      : String(result.exitCode),
                },
              ],
            },
          ],
        },
      };
    })();
    void completion.catch(() => {});
    return { completion, cancel: () => execution.cancel() };
  }
}
