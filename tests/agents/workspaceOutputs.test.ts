import { expect, spyOn, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunContext } from "../../src/RunContext";
import { BaseAgent } from "../../src/agents/BaseAgent";
import { changedWorkspaceFiles } from "../../src/agents/runtime/workspaceOutputs";
import { CreateFileTool } from "../../src/tools/create_file";
import { workspaceService } from "../../src/workspaces/WorkspaceService";

test("attaches only tool-reported paths without scanning or leaking outside the workspace", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "agent-outputs-"));
  const workspace = {
    kind: "local" as const,
    hostPath: root,
    displayPath: "/workspace",
  };
  const ctx = new RunContext(
    new BaseAgent("test", "test"),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "owner",
    workspace,
  );
  const scan = spyOn(workspaceService, "listFiles");
  try {
    await new CreateFileTool().execute(
      { path: "mine.txt", content: "mine" },
      ctx,
    );
    await fs.writeFile(join(root, "another-agent.txt"), "not mine");
    await fs.symlink("/etc/passwd", join(root, "escape"));
    ctx.writtenFiles.add("missing");
    ctx.writtenFiles.add("escape");
    const files = await changedWorkspaceFiles(
      workspace,
      ctx.writtenFiles,
      "chat",
    );
    expect(files.map((file) => file.path)).toEqual(["mine.txt"]);
    expect(scan).not.toHaveBeenCalled();
  } finally {
    scan.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});
