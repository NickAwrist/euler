import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrateJobErrors } from "../../src/db/jobErrorMigration";
import { ERROR_MESSAGES } from "../../src/schemas/observability";

test("free-text job errors become coded diagnostics", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO jobs VALUES (?, ?)");
  insert.run(
    "job_a",
    JSON.stringify({ status: "interrupted", error: "Interrupted by restart" }),
  );
  insert.run("job_b", JSON.stringify({ status: "failed", error: "boom" }));
  insert.run("job_c", JSON.stringify({ status: "succeeded" }));
  migrateJobErrors(db);
  const errors = Object.fromEntries(
    db
      .query<{ id: string; payload: string }, []>(
        "SELECT id, payload FROM jobs",
      )
      .all()
      .map((row) => [row.id, JSON.parse(row.payload).error]),
  );
  expect(errors).toEqual({
    job_a: {
      code: "JOB_INTERRUPTED",
      message: ERROR_MESSAGES.JOB_INTERRUPTED,
      jobId: "job_a",
    },
    job_b: {
      code: "JOB_FAILED",
      message: ERROR_MESSAGES.JOB_FAILED,
      jobId: "job_b",
    },
    job_c: undefined,
  });
});
