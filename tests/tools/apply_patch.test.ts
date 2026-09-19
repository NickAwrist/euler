import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunContext } from "../../src/RunContext";
import { BaseAgent } from "../../src/agents/BaseAgent";
import { ApplyPatchTool } from "../../src/tools/apply_patch";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function fixture(content: string) {
  const root = await fs.mkdtemp(join(tmpdir(), "patch-tool-"));
  roots.push(root);
  const path = join(root, "file.txt");
  await fs.writeFile(path, content, { mode: 0o755 });
  const ctx = new RunContext(
    new BaseAgent("test", "test"),
    "",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "owner",
    { kind: "local", hostPath: root, displayPath: "/workspace" },
  );
  const patch = (body: string, target = "file.txt") =>
    new ApplyPatchTool().execute(
      {
        patch: `*** Begin Patch\n*** Update File: ${target}\n${body}\n*** End Patch`,
      },
      ctx,
    );
  return { root, path, patch };
}

test("applies ordered hunks while preserving CRLF, permissions, and shortening content", async () => {
  const { path, patch } = await fixture(
    "first\r\nlong old line\r\nmiddle\r\nlast\r\n",
  );
  expect(
    (
      await patch(
        "@@\n first\n-long old line\n+x\n@@\n-last\n+end\n*** End of File",
      )
    ).text,
  ).toStartWith("Patched");
  expect(await fs.readFile(path, "utf8")).toBe(
    "first\r\nx\r\nmiddle\r\nend\r\n",
  );
  expect((await fs.stat(path)).mode & 0o777).toBe(0o755);
});

test("preserves missing final newline and supports EOF disambiguation", async () => {
  const { path, patch } = await fixture("same\nsame");
  expect((await patch("@@\n-same\n+end\n*** End of File")).text).toStartWith(
    "Patched",
  );
  expect(await fs.readFile(path, "utf8")).toBe("same\nend");
});

for (const body of [
  "@@\n-missing\n+new",
  "@@\n-same\n+new",
  "@@\n start\n-same\n+new\n@@\n-missing\n+new",
  "@@\n+new",
  "@@\n-start\n+new\n*** Update File: other.txt",
]) {
  test(`rejects invalid or ambiguous edits without writing: ${body}`, async () => {
    const original = "start\nsame\nsame\n";
    const { path, patch } = await fixture(original);
    expect((await patch(body)).text).toStartWith("Error:");
    expect(await fs.readFile(path, "utf8")).toBe(original);
  });
}

test("rejects traversal and symlink targets", async () => {
  const { root, path, patch } = await fixture("old\n");
  await fs.symlink(path, join(root, "link.txt"));
  for (const target of ["../outside.txt", "/etc/passwd", "link.txt"]) {
    expect((await patch("@@\n-old\n+new", target)).text).toStartWith("Error:");
  }
  expect(await fs.readFile(path, "utf8")).toBe("old\n");
});
