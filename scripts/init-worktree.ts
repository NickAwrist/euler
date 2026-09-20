#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseEnv } from "node:util";

export function initializeWorktree(targetDir: string, primaryRoot: string) {
  const target = resolve(targetDir);
  const primary = resolve(primaryRoot);
  const envPath = join(target, ".env");
  let envCreated = false;
  let nodeModulesLinked = false;

  if (!existsSync(envPath)) {
    const primaryEnv = join(primary, ".env");
    const source = existsSync(primaryEnv)
      ? primaryEnv
      : join(primary, ".env.example");
    let contents = readFileSync(source, "utf8");
    if (target !== primary) {
      const config = parseEnv(contents);
      const sourceDb = resolve(
        primary,
        config.AGENTS_DB_PATH || "data/agents.db",
      );
      const sourceData = config.ORBIS_DATA_ROOT
        ? resolve(primary, config.ORBIS_DATA_ROOT)
        : dirname(sourceDb);
      const targetData = join(target, "data");
      const targetDb = join(targetData, "agents.db");
      mkdirSync(targetData, { recursive: true });
      if (
        config.AGENTS_DB_PATH !== ":memory:" &&
        existsSync(sourceDb) &&
        !existsSync(targetDb)
      ) {
        // VACUUM INTO includes committed WAL data without copying live journal files.
        const db = new Database(sourceDb, { readonly: true });
        try {
          db.run("VACUUM INTO ?", [targetDb]);
        } finally {
          db.close();
        }
        // A copied UI setting must not mask the explicitly configured dev key.
        // Only change the new snapshot, never the primary or an existing worktree.
        if (
          config.OPENROUTER_API_KEY?.trim() ||
          config.AGENTS_OPENROUTER_API_KEY?.trim()
        ) {
          const copied = new Database(targetDb);
          try {
            const hasSettings = copied
              .query(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'",
              )
              .get();
            if (hasSettings)
              copied.run("DELETE FROM app_settings WHERE key = ?", [
                "openrouter_api_key",
              ]);
          } finally {
            copied.close();
          }
        }
      }
      const sourceWorkspaces = join(sourceData, "workspaces");
      const targetWorkspaces = join(targetData, "workspaces");
      if (existsSync(sourceWorkspaces) && !existsSync(targetWorkspaces)) {
        cpSync(sourceWorkspaces, targetWorkspaces, { recursive: true });
      }
      // Always keep mutable state in this checkout, even when the source uses
      // absolute paths outside the primary repository.
      contents = contents.replace(
        /^\s*(?:export\s+)?(?:AGENTS_DB_PATH|ORBIS_DATA_ROOT)\s*=.*$/gm,
        "",
      );
      contents = `${contents.trimEnd()}\n\n# Worktree-local app storage.\nAGENTS_DB_PATH=${JSON.stringify(join(target, "data", "agents.db"))}\nORBIS_DATA_ROOT=${JSON.stringify(join(target, "data"))}\n`;
    }
    writeFileSync(envPath, contents, { flag: "wx", mode: 0o600 });
    envCreated = true;
  }

  const primaryModules = join(primary, "node_modules");
  const targetModules = join(target, "node_modules");
  if (
    target !== primary &&
    existsSync(primaryModules) &&
    !existsSync(targetModules)
  ) {
    symlinkSync(relative(target, primaryModules), targetModules, "dir");
    nodeModulesLinked = true;
  }

  return { envCreated, nodeModulesLinked };
}

if (import.meta.main) {
  const cwd = process.cwd();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const primary = process.env.T3CODE_PROJECT_ROOT
    ? resolve(process.env.T3CODE_PROJECT_ROOT)
    : dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir"));
  const target = resolve(
    process.argv[2] ||
      process.env.T3CODE_WORKTREE_PATH ||
      git("rev-parse", "--show-toplevel"),
  );
  const result = initializeWorktree(target, primary);
  console.log(
    `${result.envCreated ? "Created" : "Kept existing"} ${join(target, ".env")}`,
  );
  console.log(
    "Edit .env, choose unused backend/frontend ports, then run bun run dev.",
  );
}
