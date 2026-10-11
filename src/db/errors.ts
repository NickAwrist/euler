import { SQLiteError } from "bun:sqlite";

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof SQLiteError && error.code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}
