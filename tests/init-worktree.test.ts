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
  writeFileSync(join(primary, ".env.example"), "EULER_BACKEND_PORT=3000\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("copies custom settings but isolates external storage paths", () => {
  writeFileSync(
    join(primary, ".env"),
    "OPENROUTER_API_KEY=custom-key\nEULER_BACKEND_PORT=3200\nexport EULER_DB_PATH = /external/live.db\nEULER_DATA_ROOT=/external/data\nEULER_HOST_DIRECTORY=/shared/projects\n",
  );
  expect(initializeWorktree(target, primary)).toEqual({
    envCreated: true,
    nodeModulesLinked: true,
  });
  const contents = readFileSync(join(target, ".env"), "utf8");
  expect(contents).toContain("OPENROUTER_API_KEY=custom-key");
  expect(contents).toContain("EULER_BACKEND_PORT=3200");
  expect(contents).toContain("EULER_HOST_DIRECTORY=/shared/projects");
  expect(contents).not.toContain("/external/");
  expect(contents).toContain(
    `EULER_DB_PATH=${JSON.stringify(join(target, "data", "euler.db"))}`,
  );
  expect(contents).toContain(
    `EULER_DATA_ROOT=${JSON.stringify(join(target, "data"))}`,
  );
  expect(realpathSync(join(target, "node_modules"))).toBe(
    join(primary, "node_modules"),
  );
  expect(existsSync(join(target, "data", "euler.db"))).toBe(false);
});

test("preserves an existing worktree env and dependencies on repeated setup", () => {
  initializeWorktree(target, primary);
  writeFileSync(join(target, ".env"), "EULER_BACKEND_PORT=3456\n");
  expect(initializeWorktree(target, primary)).toEqual({
    envCreated: false,
    nodeModulesLinked: false,
  });
  expect(readFileSync(join(target, ".env"), "utf8")).toBe(
    "EULER_BACKEND_PORT=3456\n",
  );
});

test("falls back to the example when the primary has no env", () => {
  initializeWorktree(target, primary);
  expect(readFileSync(join(target, ".env"), "utf8")).toContain(
    "EULER_BACKEND_PORT=3000",
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
    `EULER_DB_PATH="${dbPath}"\nEULER_DATA_ROOT=custom-data\n`,
  );
  const source = new Database(dbPath);
  source.run("PRAGMA journal_mode=WAL");
  source.run("CREATE TABLE settings (value TEXT)");
  source.run("INSERT INTO settings VALUES ('saved')");
  try {
    initializeWorktree(target, primary);
    const copied = new Database(join(target, "data", "euler.db"));
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
