import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceService } from "../../src/workspaces/WorkspaceService";
import {
  listArtifactDirectory,
  readArtifactPreview,
} from "../../src/workspaces/artifacts";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "artifacts-"));
  roots.push(root);
  const service = new WorkspaceService(root);
  return {
    service,
    workspace: await service.provisionRetained("owner", "chat"),
  };
}
test("artifact tree lists empty directories and respects ignores without traversing children", async () => {
  const { service, workspace } = await fixture();
  await fs.mkdir(join(workspace.hostPath, "empty"));
  await fs.mkdir(join(workspace.hostPath, "node_modules"));
  await service.writeFile(workspace, ".gitignore", "secret.txt");
  await service.writeFile(workspace, "secret.txt", "hidden");
  await service.writeFile(workspace, "readme.md", "# Hello");
  const entries = await listArtifactDirectory(service, workspace, ".");
  expect(entries.map((entry) => entry.name)).toEqual([
    "empty",
    ".gitignore",
    "readme.md",
  ]);
  expect(await listArtifactDirectory(service, workspace, "empty")).toEqual([]);
  expect(await readArtifactPreview(service, workspace, "readme.md")).toEqual({
    kind: "text",
    path: "readme.md",
    content: "# Hello",
  });
});
test("artifact reads reject traversal, symlinks, binary and oversized files", async () => {
  const { service, workspace } = await fixture();
  await fs.symlink("/etc/passwd", join(workspace.hostPath, "link"));
  await service.writeFile(workspace, "binary", "\u0000");
  await service.writeFile(workspace, "large", "a".repeat(1024 * 1024 + 1));
  for (const path of ["../escape", "link", "binary", "large", "."])
    await expect(
      readArtifactPreview(service, workspace, path),
    ).rejects.toThrow();
  await expect(
    listArtifactDirectory(service, workspace, "../"),
  ).rejects.toThrow();
});

test("image previews preserve bytes, use an explicit media type, and enforce their own size limit", async () => {
  const { service, workspace } = await fixture();
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    "base64",
  );
  await fs.writeFile(join(workspace.hostPath, "image.PNG"), image);
  expect(await readArtifactPreview(service, workspace, "image.PNG")).toEqual({
    kind: "image",
    path: "image.PNG",
    mediaType: "image/png",
    data: image.toString("base64"),
  });
  await fs.writeFile(
    join(workspace.hostPath, "huge.png"),
    Buffer.alloc(10 * 1024 * 1024 + 1),
  );
  await expect(
    readArtifactPreview(service, workspace, "huge.png"),
  ).rejects.toThrow("10 MB");
  await service.writeFile(
    workspace,
    "safe.svg",
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  expect(
    await readArtifactPreview(service, workspace, "safe.svg"),
  ).toMatchObject({ kind: "image", mediaType: "image/svg+xml" });
  await fs.symlink("/etc/passwd", join(workspace.hostPath, "escape.png"));
  await expect(
    readArtifactPreview(service, workspace, "escape.png"),
  ).rejects.toThrow();
});
