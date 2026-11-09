import "../setup";
import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { envConfig } from "../../src/env";
import { Code, rpc, rpcCode } from "../helpers/rpc";

test("browses server directories and completes partial paths without reading files", async () => {
  const { directories } = rpc();
  const root = await fs.mkdtemp(join(tmpdir(), "orbis-browse-"));
  const browse = (path: string) => directories.listDirectory({ path });
  try {
    await fs.mkdir(join(root, "Desktop"));
    await fs.mkdir(join(root, ".hidden"));
    await fs.writeFile(join(root, "secret.txt"), "not returned");
    await fs.symlink(join(root, "Desktop"), join(root, "linked"));
    await fs.symlink(join(root, "missing"), join(root, "broken"));
    expect(await browse(root)).toMatchObject({
      path: await fs.realpath(root),
      exact: true,
      parent: dirname(await fs.realpath(root)),
      directories: [".hidden", "Desktop", "linked"].map((name) => ({
        name,
        path: join(root, name),
      })),
    });
    expect(await browse(join(root, "des"))).toMatchObject({
      path: root,
      exact: false,
      directories: [{ name: "Desktop", path: join(root, "Desktop") }],
    });
    expect(await browse(join(root, "Desktop"))).toMatchObject({
      parent: root,
      exact: true,
      directories: [],
    });
    expect(await browse("~")).toMatchObject({
      path: await fs.realpath(homedir()),
      exact: true,
    });
    expect((await browse(parse(root).root)).parent).toBeUndefined();
    for (const path of [
      "relative",
      join(root, "secret.txt"),
      join(root, "missing", "nested"),
      "\0",
    ])
      expect(await rpcCode(browse(path))).toBe(Code.InvalidArgument);
    expect(
      await rpcCode(rpc(null).directories.listDirectory({ path: root })),
    ).toBe(Code.InvalidArgument);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("browses the configured host folder for default and tilde paths", async () => {
  const { directories } = rpc();
  const root = await fs.mkdtemp(join(tmpdir(), "orbis-host-browse-"));
  const previous = envConfig.hostDirectory;
  envConfig.hostDirectory = root;
  try {
    await fs.mkdir(join(root, "projects"));
    for (const path of ["", "~", "~/projects"]) {
      expect(await directories.listDirectory({ path })).toMatchObject({
        path: path.endsWith("/projects") ? join(root, "projects") : root,
        exact: true,
      });
    }
  } finally {
    envConfig.hostDirectory = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
