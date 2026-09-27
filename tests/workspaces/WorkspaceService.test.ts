import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateSessionsWorkspaceKindColumn } from "../../src/db/migrations";
import {
  WorkspaceError,
  WorkspaceService,
} from "../../src/workspaces/WorkspaceService";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function service(): Promise<WorkspaceService> {
  const root = await fs.mkdtemp(join(tmpdir(), "orbis-workspace-test-"));
  roots.push(root);
  return new WorkspaceService(root);
}

describe("workspace service", () => {
  test("gives each owner and chat a different retained path", async () => {
    const workspaces = await service();
    const first = await workspaces.provisionRetained("owner-a", "chat-a");
    const second = await workspaces.provisionRetained("owner-a", "chat-b");
    const third = await workspaces.provisionRetained("owner-b", "chat-a");

    expect(
      new Set([first.hostPath, second.hostPath, third.hostPath]).size,
    ).toBe(3);
    expect(first.displayPath).toBe("/workspace");
  });

  test("rejects traversal and symlinks that leave the workspace", async () => {
    const workspaces = await service();
    const workspace = await workspaces.provisionRetained("owner-a", "chat-a");
    const outside = await fs.mkdtemp(join(tmpdir(), "orbis-outside-test-"));
    roots.push(outside);
    await fs.writeFile(join(outside, "secret.txt"), "secret");
    await fs.symlink(outside, join(workspace.hostPath, "escape"));

    await expect(
      workspaces.resolveExistingPath(workspace, "../secret.txt"),
    ).rejects.toBeInstanceOf(WorkspaceError);
    await expect(
      workspaces.resolveExistingPath(workspace, "escape/secret.txt"),
    ).rejects.toBeInstanceOf(WorkspaceError);
    await expect(
      workspaces.writeFile(workspace, "escape/new.txt", "bad"),
    ).rejects.toThrow();
  });

  test("maps shell paths for both local and sandbox workspaces", async () => {
    const workspaces = await service();
    const lease = await workspaces.createTemporary("owner-a");
    const local = await fs.mkdtemp(join(tmpdir(), "orbis-path-test-"));
    roots.push(local);
    for (const kind of ["sandbox", "local"] as const) {
      if (kind === "local")
        await workspaces.selectTemporaryDirectory("owner-a", lease.id, local);
      const workspace = await workspaces.resolveTemporary("owner-a", lease.id);
      expect(workspace.displayPath).toBe("/workspace");
      const target = join(workspace.hostPath, "output.txt");
      await workspaces.writeFile(workspace, "/workspace/output.txt", "output");
      expect(
        await workspaces.resolveExistingPath(workspace, "output.txt"),
      ).toBe(target);
      expect(
        await workspaces.resolveExistingPath(
          workspace,
          "/workspace/output.txt",
        ),
      ).toBe(target);
      await expect(
        workspaces.resolveExistingPath(workspace, "/workspace/../outside"),
      ).rejects.toThrow();
    }
  });

  test("expiry removes leases and private files while preserving local directories and active turns", async () => {
    const workspaces = await service();
    const lease = await workspaces.createTemporary("owner-a");
    const local = await fs.mkdtemp(join(tmpdir(), "orbis-expiry-test-"));
    roots.push(local);
    await workspaces.selectTemporaryDirectory("owner-a", lease.id, local);
    lease.expiresAt = Date.now() - 1;
    let busy = true;
    workspaces.setAgentLifecycle({
      isBusy: () => busy,
      onExpire: async () => {},
    });
    await workspaces.cleanupExpired();
    await fs.access(lease.hostPath);
    busy = false;
    await workspaces.cleanupExpired();
    await expect(fs.access(lease.hostPath)).rejects.toThrow();
    expect(await workspaces.deleteTemporary("owner-a", lease.id)).toBeFalse();
    await fs.access(local);
  });

  test("scans outputs beyond 1,000 dependency files before sorting", async () => {
    const workspaces = await service();
    const workspace = await workspaces.provisionRetained("owner-a", "chat-a");
    const dependencies = join(workspace.hostPath, "dependencies");
    await fs.mkdir(dependencies);
    await Promise.all(
      Array.from({ length: 1000 }, async (_, index) => {
        const path = join(dependencies, `${index}.txt`);
        await fs.writeFile(path, "dependency");
        await fs.utimes(path, 1, 1);
      }),
    );
    await fs.writeFile(join(workspace.hostPath, "output.txt"), "output");
    const files = await workspaces.listFiles(workspace);
    expect(files).toHaveLength(1001);
    expect(files.slice(0, 200)[0]?.path).toBe("output.txt");
  });

  test("temporary leases are owner-scoped and disappear on delete", async () => {
    const workspaces = await service();
    const lease = await workspaces.createTemporary("owner-a");
    await expect(
      workspaces.resolveTemporary("owner-b", lease.id),
    ).rejects.toThrow();
    expect(await workspaces.deleteTemporary("owner-a", lease.id)).toBeTrue();
    await expect(
      workspaces.resolveTemporary("owner-a", lease.id),
    ).rejects.toThrow();
  });

  test("deleting a temporary chat never deletes its selected local directory", async () => {
    const workspaces = await service();
    const localDirectory = await fs.mkdtemp(
      join(tmpdir(), "orbis-local-workspace-test-"),
    );
    roots.push(localDirectory);
    const localFile = join(localDirectory, "keep.txt");
    await fs.writeFile(localFile, "keep");
    const lease = await workspaces.createTemporary("owner-a");

    await workspaces.selectTemporaryDirectory(
      "owner-a",
      lease.id,
      localDirectory,
    );
    expect((await workspaces.resolveTemporary("owner-a", lease.id)).kind).toBe(
      "local",
    );
    expect(await workspaces.deleteTemporary("owner-a", lease.id)).toBeTrue();
    expect(await fs.readFile(localFile, "utf8")).toBe("keep");
  });
});

test("workspace migration backfills local and sandbox rows", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE sessions (id TEXT PRIMARY KEY, session_directory TEXT)");
  db.run(
    "INSERT INTO sessions VALUES ('local', '/tmp/project'), ('empty', '  '), ('unset', NULL)",
  );
  migrateSessionsWorkspaceKindColumn(db);
  const rows = db
    .query("SELECT id, workspace_kind FROM sessions ORDER BY id")
    .all();
  expect(rows).toEqual([
    { id: "empty", workspace_kind: "sandbox" },
    { id: "local", workspace_kind: "local" },
    { id: "unset", workspace_kind: "sandbox" },
  ]);
  db.close();
});
