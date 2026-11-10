import fs from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { envConfig } from "../env";
import { OperationError } from "../observability/errors";

export type DirectoryListing = {
  path: string;
  exact: boolean;
  parent: string | null;
  directories: { name: string; path: string }[];
};

const invalid = (message: string) =>
  new OperationError("INVALID_REQUEST", { message });

/**
 * Subfolders of a server folder for the directory picker. A missing last
 * segment lists its parent's subfolders that start with it.
 */
export async function listDirectory(input: string): Promise<DirectoryListing> {
  const requested = input.trim();
  const home = envConfig.hostDirectory || homedir();
  const expanded =
    requested === "~" || requested.startsWith("~/")
      ? join(home, requested.slice(1))
      : requested || home;
  if (!isAbsolute(expanded) || expanded.includes("\0"))
    throw invalid("Enter an absolute folder path on the server");
  try {
    let path = resolve(expanded);
    let prefix = "";
    try {
      if (!(await fs.stat(path)).isDirectory())
        throw invalid("Selected path is not a directory");
    } catch (error) {
      if (error instanceof OperationError) throw error;
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
      prefix = basename(path).toLocaleLowerCase();
      path = dirname(path);
    }
    path = await fs.realpath(path);
    const entries = await fs.readdir(path, { withFileTypes: true });
    const directories = (
      await Promise.all(
        entries.map(async (entry) => {
          if (!entry.name.toLocaleLowerCase().startsWith(prefix)) return null;
          const childPath = join(path, entry.name);
          const directory =
            entry.isDirectory() ||
            (entry.isSymbolicLink() &&
              (await fs.stat(childPath).then(
                (stat) => stat.isDirectory(),
                () => false,
              )));
          return directory ? { name: entry.name, path: childPath } : null;
        }),
      )
    )
      .filter((entry) => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      path,
      exact: prefix === "",
      parent: dirname(path) === path ? null : dirname(path),
      directories,
    };
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw invalid(
      "Could not browse this directory. Check that it exists and is accessible.",
    );
  }
}
