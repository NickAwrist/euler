import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./constants";
import { createSchema } from "./schema";

let dbSingleton: Database | null = null;

export function getDb(): Database {
  if (dbSingleton) return dbSingleton;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.run("PRAGMA foreign_keys = ON;");
  db.run("PRAGMA journal_mode = WAL;");
  createSchema(db);
  dbSingleton = db;
  return db;
}

export function resetDbConnection(): void {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
}

/** Runs `write` in one transaction; a nested call becomes a savepoint. */
export function transaction<T>(write: () => T): T {
  return getDb().transaction(write)();
}
