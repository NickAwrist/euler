import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { permissionService } from "../../src/permissions/PermissionService";
import { BubblewrapSandboxRunner } from "../../src/sandbox/SandboxRunner";
import { discoverToolchains } from "../../src/sandbox/toolchains";
import { capabilitiesSchema } from "../../src/schemas/userPreferences";

const runner = new BubblewrapSandboxRunner();
const capability = await runner.capability();
const tools = discoverToolchains();

test.skipIf(
  !capability.available || !tools.some((tool) => tool.name === "bun"),
)(
  "directory policy runs development runtimes while containing files and environment",
  async () => {
    const root = await mkdtemp("/tmp/euler-development-");
    const hostPath = join(root, "project");
    await mkdir(hostPath);
    await writeFile(join(hostPath, "package.json"), "{}");
    await writeFile(join(root, "secret"), "hidden");
    const workspace = {
      kind: "local" as const,
      hostPath,
      displayPath: "/workspace",
    };
    const previousSecret = process.env.EULER_DEVELOPMENT_TEST_SECRET;
    process.env.EULER_DEVELOPMENT_TEST_SECRET = "host-only-marker";
    try {
      const result = await runner
        .spawn({
          permissions: permissionService.resolve(workspace),
          workspace,
          command: `bun --version && bunx --version && ${tools.some((tool) => tool.name === "node") ? "node --version && " : ""}test ! -e '${root}/secret' && test -z "$EULER_DEVELOPMENT_TEST_SECRET" && touch /workspace/allowed && test ! -w /opt/euler/bin/bun && test ! -w /usr && ulimit -v && bun pm cache`,
        })
        .then(({ completion }) => completion);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("unlimited");
      expect(result.stdout.trim().split("\n").at(-1)).toStartWith("/tmp/home/");
      await expect(
        runner
          .spawn({
            permissions: permissionService.resolve(workspace),
            workspace,
            command: "touch /usr/euler-denied",
          })
          .then(({ completion }) => completion),
      ).resolves.toMatchObject({ exitCode: 1 });
      await expect(
        runner.spawn({
          workspace,
          command: "true",
          permissions: permissionService.resolve(
            workspace,
            capabilitiesSchema.parse({ shell: false }),
          ),
        }),
      ).rejects.toThrow("shell capability is disabled");
    } finally {
      if (previousSecret === undefined)
        Reflect.deleteProperty(process.env, "EULER_DEVELOPMENT_TEST_SECRET");
      else process.env.EULER_DEVELOPMENT_TEST_SECRET = previousSecret;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(
  !capability.available || !tools.some((tool) => tool.name === "bun"),
)(
  "directory background servers are reachable from the host and another command and stop on cancellation",
  async () => {
    const hostPath = await mkdtemp("/tmp/euler-development-server-");
    const workspace = {
      kind: "local" as const,
      hostPath,
      displayPath: "/workspace",
    };
    let output = "";
    const execution = await runner.spawn({
      permissions: permissionService.resolve(workspace),
      workspace,
      background: true,
      command: `bun -e 'const server = Bun.serve({hostname:"0.0.0.0",port:0,fetch:()=>new Response("development server")}); console.log("READY",server.port);'`,
      emitOutput: (chunk) => {
        output += chunk.text;
      },
    });
    try {
      const deadline = Date.now() + 5000;
      while (!/READY (\d+)/.test(output)) {
        if (Date.now() > deadline)
          throw new Error(`Server failed to start: ${output}`);
        await Bun.sleep(10);
      }
      const port = /READY (\d+)/.exec(output)![1];
      const response = await fetch(`http://127.0.0.1:${port}`);
      expect(await response.text()).toBe("development server");
      const result = await runner
        .spawn({
          permissions: permissionService.resolve(workspace),
          workspace,
          command: `bun -e 'console.log(await (await fetch("http://127.0.0.1:${port}")).text())'`,
        })
        .then(({ completion }) => completion);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("development server");
      await execution.cancel();
      await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
    } finally {
      await execution.cancel();
      await rm(hostPath, { recursive: true, force: true });
    }
  },
);
