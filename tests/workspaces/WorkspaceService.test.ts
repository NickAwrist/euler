import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateSessionsWorkspaceKindColumn } from "../../src/db/migrations";
import type { SessionRow } from "../../src/db/types";
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

function sessionRow(directory: string | null): SessionRow {
  return {
    id: "chat-a",
    owner_uuid: "owner-a",
    created_at: 0,
    updated_at: 0,
    title: null,
    model: null,
    session_directory: directory,
    workspace_kind: directory ? "local" : "sandbox",
    expires_at: Date.now(),
  };
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
    const local = await fs.mkdtemp(join(tmpdir(), "orbis-path-test-"));
    roots.push(local);
    for (const directory of [null, local]) {
      const workspace = await workspaces.resolveSession(sessionRow(directory));
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

  test("deleting a chat's sandbox never deletes its selected local directory", async () => {
    const workspaces = await service();
    const localDirectory = await fs.mkdtemp(
      join(tmpdir(), "orbis-local-workspace-test-"),
    );
    roots.push(localDirectory);
    const localFile = join(localDirectory, "keep.txt");
    await fs.writeFile(localFile, "keep");
    const sandbox = await workspaces.provisionRetained("owner-a", "chat-a");
    const row = sessionRow(localDirectory);

    expect((await workspaces.resolveSession(row)).kind).toBe("local");
    await workspaces.deleteRetained(row.owner_uuid, row.id);
    await expect(fs.access(sandbox.hostPath)).rejects.toThrow();
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
