import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { permissionService } from "../../src/permissions/PermissionService";
import { BubblewrapSandboxRunner } from "../../src/sandbox/SandboxRunner";
import { discoverToolchains } from "../../src/sandbox/toolchains";
import type { Workspace } from "../../src/workspaces/WorkspaceService";

const directories: string[] = [];
const capability = await new BubblewrapSandboxRunner().capability();

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<Workspace> {
  const hostPath = await fs.mkdtemp(join(tmpdir(), "orbis-runner-test-"));
  directories.push(hostPath);
  return { kind: "sandbox", hostPath, displayPath: "/workspace" };
}

describe("bubblewrap sandbox runner", () => {
  test.skipIf(!capability.available || process.getuid?.() !== 0)(
    "skips a root-private toolchain when launching as the local directory owner",
    async () => {
      const root = await fs.mkdtemp(join(tmpdir(), "euler-root-toolchain-"));
      directories.push(root);
      await fs.chmod(root, 0o755);
      const privateBin = join(root, "private");
      const hostPath = join(root, "project");
      await fs.mkdir(privateBin, { mode: 0o700 });
      await fs.copyFile(process.execPath, join(privateBin, "node"));
      await fs.chmod(join(privateBin, "node"), 0o755);
      await fs.mkdir(hostPath, { mode: 0o700 });
      await fs.chown(hostPath, 1000, 1000);
      const previousPath = process.env.PATH;
      try {
        process.env.PATH = `${privateBin}:/usr/bin:/bin`;
        expect(
          discoverToolchains().find((tool) => tool.name === "node")?.path,
        ).toBe(join(privateBin, "node"));
        expect(
          discoverToolchains({ uid: 1000, gid: 1000 }).some(
            (tool) => tool.path === join(privateBin, "node"),
          ),
        ).toBe(false);
        const workspace = {
          kind: "local" as const,
          hostPath,
          displayPath: "/workspace",
        };
        const result = await new BubblewrapSandboxRunner()
          .spawn({
            workspace,
            permissions: permissionService.resolve(workspace),
            command: "touch created.txt; id -u",
          })
          .then(({ completion }) => completion);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("1000");
        expect((await fs.stat(join(hostPath, "created.txt"))).uid).toBe(1000);
      } finally {
        if (previousPath === undefined)
          Reflect.deleteProperty(process.env, "PATH");
        else process.env.PATH = previousPath;
      }
    },
  );
  test.skipIf(!capability.available || process.getuid?.() !== 0)(
    "runs a local workspace as its owner beneath a private home directory",
    async () => {
      const parent = await fs.mkdtemp(join(tmpdir(), "orbis-private-home-"));
      directories.push(parent);
      const hostPath = join(parent, "project");
      await fs.mkdir(hostPath, { mode: 0o700 });
      await fs.chown(parent, 1000, 1000);
      await fs.chown(hostPath, 1000, 1000);

      const result = await new BubblewrapSandboxRunner()
        .spawn({
          permissions: permissionService.resolve({ kind: "local" }),
          command: "touch created.txt; id -u",
          workspace: { kind: "local", hostPath, displayPath: "/workspace" },
        })
        .then(({ completion }) => completion);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("1000");
      expect((await fs.stat(join(hostPath, "created.txt"))).uid).toBe(1000);
    },
  );

  test.skipIf(capability.available)(
    "fails closed when containment is unavailable",
    async () => {
      const runner = new BubblewrapSandboxRunner();

      await expect(
        runner
          .spawn({
            permissions: permissionService.resolve({ kind: "sandbox" }),
            command: "pwd",
            workspace: await workspace(),
          })
          .then(({ completion }) => completion),
      ).rejects.toThrow("Shell tools are disabled");
    },
  );

  test.skipIf(!capability.available)(
    "allows workspace writes but rejects host-system writes",
    async () => {
      const runner = new BubblewrapSandboxRunner();
      const activeWorkspace = await workspace();

      const result = await runner
        .spawn({
          permissions: permissionService.resolve(activeWorkspace),
          command:
            "touch /workspace/inside.txt; touch /usr/orbis-sandbox-escape-test",
          workspace: activeWorkspace,
        })
        .then(({ completion }) => completion);

      expect(
        await fs.readFile(join(activeWorkspace.hostPath, "inside.txt")),
      ).toBeDefined();
      expect(result.exitCode).not.toBe(0);
      await expect(
        fs.access("/usr/orbis-sandbox-escape-test"),
      ).rejects.toThrow();
    },
  );

  test.skipIf(!capability.available)(
    "has no network namespace access",
    async () => {
      const runner = new BubblewrapSandboxRunner();

      const result = await runner
        .spawn({
          permissions: permissionService.resolve({ kind: "sandbox" }),
          command:
            "python3 -c \"import socket; socket.create_connection(('1.1.1.1', 53), 0.2)\"",
          workspace: await workspace(),
        })
        .then(({ completion }) => completion);
      expect(result.exitCode).not.toBe(0);
    },
  );
});

test.skipIf(!capability.available || !existsSync("/etc/alternatives/awk"))(
  "runs alternatives-backed executables inside the sandbox",
  async () => {
    const result = await new BubblewrapSandboxRunner()
      .spawn({
        permissions: permissionService.resolve({ kind: "sandbox" }),
        command: "awk 'BEGIN { print 42 }'",
        workspace: await workspace(),
      })
      .then(({ completion }) => completion);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("42");
  },
);
