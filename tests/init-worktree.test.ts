import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeWorktree } from "../scripts/init-worktree";

let root: string;
let primary: string;
let target: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-worktree-"));
  primary = join(root, "primary");
  target = join(root, "worktree");
  mkdirSync(join(primary, "node_modules"), { recursive: true });
  mkdirSync(target);
  writeFileSync(join(primary, ".env.example"), "AGENTS_BACKEND_PORT=3000\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("copies custom settings but isolates external storage paths", () => {
  writeFileSync(
    join(primary, ".env"),
    "OPENROUTER_API_KEY=custom-key\nAGENTS_BACKEND_PORT=3200\nexport AGENTS_DB_PATH = /external/live.db\nORBIS_DATA_ROOT=/external/data\nAGENTS_HOST_DIRECTORY=/shared/projects\n",
  );
  expect(initializeWorktree(target, primary)).toEqual({
    envCreated: true,
    nodeModulesLinked: true,
  });
  const contents = readFileSync(join(target, ".env"), "utf8");
  expect(contents).toContain("OPENROUTER_API_KEY=custom-key");
  expect(contents).toContain("AGENTS_BACKEND_PORT=3200");
  expect(contents).toContain("AGENTS_HOST_DIRECTORY=/shared/projects");
  expect(contents).not.toContain("/external/");
  expect(contents).toContain(
    `AGENTS_DB_PATH=${JSON.stringify(join(target, "data", "agents.db"))}`,
  );
  expect(contents).toContain(
    `ORBIS_DATA_ROOT=${JSON.stringify(join(target, "data"))}`,
  );
  expect(realpathSync(join(target, "node_modules"))).toBe(
    join(primary, "node_modules"),
  );
  expect(existsSync(join(target, "data", "agents.db"))).toBe(false);
});

test("preserves an existing worktree env and dependencies on repeated setup", () => {
  initializeWorktree(target, primary);
  writeFileSync(join(target, ".env"), "AGENTS_BACKEND_PORT=3456\n");
  expect(initializeWorktree(target, primary)).toEqual({
    envCreated: false,
    nodeModulesLinked: false,
  });
  expect(readFileSync(join(target, ".env"), "utf8")).toBe(
    "AGENTS_BACKEND_PORT=3456\n",
  );
});

test("falls back to the example when the primary has no env", () => {
  initializeWorktree(target, primary);
  expect(readFileSync(join(target, ".env"), "utf8")).toContain(
    "AGENTS_BACKEND_PORT=3000",
  );
});

test("initializes the primary env without linking its own dependencies", () => {
  expect(initializeWorktree(primary, primary)).toEqual({
    envCreated: true,
    nodeModulesLinked: false,
  });
  expect(readFileSync(join(primary, ".env"), "utf8")).toBe(
    readFileSync(join(primary, ".env.example"), "utf8"),
  );
  expect(initializeWorktree(primary, primary).envCreated).toBe(false);
});

test("snapshots committed WAL data and copies retained workspaces without changing the source", () => {
  const data = join(primary, "custom-data");
  mkdirSync(join(data, "workspaces", "session"), { recursive: true });
  writeFileSync(join(data, "workspaces", "session", "file.txt"), "original");
  const dbPath = join(data, "custom.db");
  writeFileSync(
    join(primary, ".env"),
    `AGENTS_DB_PATH="${dbPath}"\nORBIS_DATA_ROOT=custom-data\n`,
  );
  const source = new Database(dbPath);
  source.run("PRAGMA journal_mode=WAL");
  source.run("CREATE TABLE settings (value TEXT)");
  source.run("INSERT INTO settings VALUES ('saved')");
  try {
    initializeWorktree(target, primary);
    const copied = new Database(join(target, "data", "agents.db"));
    try {
      expect(copied.query("SELECT value FROM settings").get()).toEqual({
        value: "saved",
      });
      copied.run("UPDATE settings SET value='changed'");
      initializeWorktree(target, primary);
      expect(copied.query("SELECT value FROM settings").get()).toEqual({
        value: "changed",
      });
      expect(source.query("SELECT value FROM settings").get()).toEqual({
        value: "saved",
      });
    } finally {
      copied.close();
    }
    const copiedFile = join(
      target,
      "data",
      "workspaces",
      "session",
      "file.txt",
    );
    expect(readFileSync(copiedFile, "utf8")).toBe("original");
    writeFileSync(copiedFile, "changed");
    expect(
      readFileSync(join(data, "workspaces", "session", "file.txt"), "utf8"),
    ).toBe("original");
  } finally {
    source.close();
  }
});

for (const envName of [
  "OPENROUTER_API_KEY",
  "AGENTS_OPENROUTER_API_KEY",
  null,
]) {
  test(`copied database respects ${envName ?? "a saved key when no environment key is configured"}`, () => {
    const data = join(primary, "data");
    mkdirSync(data);
    writeFileSync(join(primary, ".env"), envName ? `${envName}=dev-key\n` : "");
    const source = new Database(join(data, "agents.db"));
    source.run("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)");
    source.run(
      "INSERT INTO app_settings VALUES ('openrouter_api_key', 'saved-key'), ('other', 'keep')",
    );
    const key = (db: Database) =>
      db
        .query(
          "SELECT value FROM app_settings WHERE key = 'openrouter_api_key'",
        )
        .get();
    try {
      initializeWorktree(target, primary);
      const copied = new Database(join(target, "data", "agents.db"));
      try {
        expect(key(copied)).toEqual(envName ? null : { value: "saved-key" });
        expect(key(source)).toEqual({ value: "saved-key" });
        expect(
          copied
            .query("SELECT value FROM app_settings WHERE key = 'other'")
            .get(),
        ).toEqual({ value: "keep" });
        // Reinitializing must preserve a key explicitly set in this worktree.
        copied.run(
          "INSERT OR REPLACE INTO app_settings VALUES ('openrouter_api_key', 'worktree-key')",
        );
        initializeWorktree(target, primary);
        expect(key(copied)).toEqual({ value: "worktree-key" });
      } finally {
        copied.close();
      }
    } finally {
      source.close();
    }
  });
}
