#!/usr/bin/env bun
/**
 * The contract gate run by `bun run lint`: the protos lint clean, stay
 * compatible with origin/main, and the committed TypeScript and Swift match a
 * fresh `buf generate`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const GENERATED_DIRECTORIES = [
  "src/gen",
  "ios/EulerAPI/Sources/EulerAPI/Generated",
];
const BASE_REF = process.env.PROTO_BASE_REF ?? "origin/main";
// buf runs the local protoc-gen-es from node_modules.
const env = {
  ...process.env,
  PATH: `${join(ROOT, "node_modules/.bin")}:${process.env.PATH}`,
};

function buf(args: string[]): void {
  execFileSync("buf", args, { cwd: ROOT, stdio: "inherit", env });
}

function hasProtosAt(ref: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:proto`], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const workspace = mkdtempSync(join(tmpdir(), "euler-proto-check-"));
try {
  buf(["lint"]);

  if (hasProtosAt(BASE_REF)) {
    const base = join(workspace, "base");
    mkdirSync(base);
    const archive = execFileSync(
      "git",
      ["archive", BASE_REF, "buf.yaml", "buf.lock", "proto"],
      { cwd: ROOT },
    );
    execFileSync("tar", ["-x", "-C", base], { input: archive });
    buf(["breaking", "--against", base]);
  } else {
    console.log(
      `[proto] ${BASE_REF} has no protos yet; skipping the breaking check.`,
    );
  }

  const fresh = join(workspace, "fresh");
  buf(["generate", "--output", fresh]);
  const stale = GENERATED_DIRECTORIES.filter((directory) => {
    if (!existsSync(join(fresh, directory))) return true;
    try {
      execFileSync(
        "diff",
        ["-r", join(fresh, directory), join(ROOT, directory)],
        { stdio: "ignore" },
      );
      return false;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) {
    console.error(
      `[proto] Generated code is stale in ${stale.join(", ")}. Run bun run proto.`,
    );
    process.exit(1);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
