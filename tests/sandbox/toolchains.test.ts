import { expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { discoverToolchains } from "../../src/sandbox/toolchains";

const nodeRuntime = discoverToolchains().find((tool) => tool.name === "node");

test.skipIf(!nodeRuntime)(
  "discovery skips script shims and finds a real runtime later on PATH",
  async () => {
    const root = await mkdtemp("/tmp/euler-toolchains-");
    const shims = join(root, "shims");
    const binaries = join(root, "binaries");
    await mkdir(shims);
    await mkdir(binaries);
    await writeFile(
      join(shims, "node"),
      '#!/bin/sh\nexec ~/.runtime-manager/node "$@"\n',
    );
    await chmod(join(shims, "node"), 0o755);
    await symlink(nodeRuntime!.path, join(binaries, "node"));
    const previousPath = process.env.PATH;
    try {
      process.env.PATH = `${shims}:${binaries}`;
      expect(
        discoverToolchains().find((tool) => tool.name === "node")?.path,
      ).toBe(nodeRuntime!.path);
    } finally {
      if (previousPath === undefined)
        Reflect.deleteProperty(process.env, "PATH");
      else process.env.PATH = previousPath;
      await rm(root, { recursive: true, force: true });
    }
  },
);
