import { spawnSync } from "node:child_process";
import {
  constants,
  accessSync,
  closeSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, delimiter, isAbsolute, join } from "node:path";

export type ExecutionUser = { uid: number; gid: number };

/** Expose executable files, never their containing home or credential folders. */
export function discoverToolchains(
  owner?: ExecutionUser,
): { name: string; path: string }[] {
  return ["bun", "node"].flatMap((name) => {
    const candidates = (process.env.PATH ?? "")
      .split(delimiter)
      .filter(isAbsolute)
      .map((directory) => join(directory, name));
    if (basename(process.execPath) === name)
      candidates.unshift(process.execPath);
    for (const candidate of candidates) {
      try {
        const path = realpathSync(candidate);
        if (!statSync(path).isFile()) continue;
        accessSync(path, constants.X_OK);
        const fd = openSync(path, "r");
        const header = Buffer.alloc(4);
        try {
          readSync(fd, header, 0, header.length, 0);
        } finally {
          closeSync(fd);
        }
        // Shell-script shims depend on runtime managers in the hidden host home.
        if (!header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) continue;
        if (owner) {
          // Let the kernel check traversal and ACLs with the same identity as bwrap.
          const access = spawnSync(
            "/usr/bin/setpriv",
            [
              "--reuid",
              String(owner.uid),
              "--regid",
              String(owner.gid),
              "--clear-groups",
              "--",
              "/usr/bin/test",
              "-r",
              path,
              "-a",
              "-x",
              path,
            ],
            { stdio: "ignore", timeout: 1000 },
          );
          if (access.status !== 0) continue;
        }
        return [{ name, path }];
      } catch {
        // Missing or inaccessible PATH entries do not prevent discovery.
      }
    }
    return [];
  });
}
