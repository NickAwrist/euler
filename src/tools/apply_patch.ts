import { constants } from "node:fs";
import type { Tool } from "ollama";
import type { RunContext } from "../RunContext";
import { workspaceService } from "../workspaces/WorkspaceService";
import { BaseTool, type ToolResult, textToolResult } from "./BaseTool";
import { requireWorkspace, workspaceError } from "./workspace";

type Hunk = { before: string[]; after: string[]; eof: boolean };

function parsePatch(patch: string): { path: string; hunks: Hunk[] } {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch")
    throw new Error("Expected *** Begin Patch and *** End Patch envelope");
  const header = lines.shift();
  if (!header?.startsWith("*** Update File: ") || !header.slice(17).trim())
    throw new Error("Expected one *** Update File: path header");
  const hunks: Hunk[] = [];
  let hunk: Hunk | undefined;
  let changed = false;
  for (const line of lines) {
    if (line === "@@") {
      hunk = { before: [], after: [], eof: false };
      hunks.push(hunk);
    } else if (line === "*** End of File" && hunk && !hunk.eof) {
      hunk.eof = true;
    } else if (hunk && !hunk.eof && /^[ +\-]/.test(line)) {
      if (line[0] !== "+") hunk.before.push(line.slice(1));
      if (line[0] !== "-") hunk.after.push(line.slice(1));
      if (line[0] !== " ") changed = true;
    } else {
      throw new Error(
        "Invalid patch line. Use @@, then space/-/+ prefixed lines; one file per call",
      );
    }
  }
  if (!changed || hunks.some((item) => item.before.length === 0))
    throw new Error(
      "Each hunk requires existing context or removed lines, and the patch must contain an edit",
    );
  return { path: header.slice(17), hunks };
}

function applyHunks(content: string, hunks: Hunk[]): string {
  if (content.includes("\0")) throw new Error("Cannot patch a binary file");
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = content.endsWith("\n");
  const lines = content.split(newline);
  if (trailingNewline) lines.pop();
  let cursor = 0;
  const output: string[] = [];
  for (const hunk of hunks) {
    let match = -1;
    for (let i = cursor; i <= lines.length - hunk.before.length; i++) {
      if (hunk.eof && i + hunk.before.length !== lines.length) continue;
      if (!hunk.before.every((line, offset) => lines[i + offset] === line))
        continue;
      if (match !== -1)
        throw new Error("Ambiguous hunk; include more unchanged context");
      match = i;
    }
    if (match === -1)
      throw new Error(
        "Hunk does not match the file; read it again before retrying",
      );
    output.push(...lines.slice(cursor, match), ...hunk.after);
    cursor = match + hunk.before.length;
  }
  output.push(...lines.slice(cursor));
  return (
    output.join(newline) + (trailingNewline && output.length ? newline : "")
  );
}

export class ApplyPatchTool extends BaseTool {
  constructor() {
    super(
      "apply_patch",
      "Edit one existing text file using exact context hunks. Prefer this for edits instead of rewriting with create_file. All hunks are checked before writing. Preserves line endings and final newline. Use create_file/delete_file for creation/deletion, or bash for shell edits.",
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
          required: ["patch"],
          properties: {
            patch: {
              type: "string",
              description:
                "Format: *** Begin Patch\n*** Update File: path\n@@\n unchanged context\n-old line\n+new line\n*** End Patch. Paths are relative to /workspace or absolute beneath it. Repeat @@ for multiple ordered, non-overlapping hunks. Each hunk needs unique exact context. Optional *** End of File anchors the preceding hunk at EOF. Only bare @@ separators are supported, not line numbers or section labels. One existing file per call.",
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
      if (typeof args.patch !== "string")
        throw new Error("patch must be a string");
      const { path, hunks } = parsePatch(args.patch);
      const file = await workspaceService.openFile(
        requireWorkspace(ctx),
        path,
        constants.O_RDWR,
      );
      try {
        const content = await file.readFile("utf8");
        const updated = applyHunks(content, hunks);
        if (ctx?.signal?.aborted) throw new Error("Patch aborted");
        // Write through the same pinned descriptor used for reading. Never reopen
        // the path, which could have been replaced with a symlink in the meantime.
        const bytes = Buffer.from(updated);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await file.write(
            bytes,
            offset,
            bytes.length - offset,
            offset,
          );
          if (!bytesWritten) throw new Error("Unable to finish writing patch");
          offset += bytesWritten;
        }
        await file.truncate(bytes.length);
        return textToolResult(`Patched ${path} (${hunks.length} hunks)`);
      } finally {
        await file.close();
      }
    } catch (error) {
      return textToolResult(workspaceError(error));
    }
  }
}
