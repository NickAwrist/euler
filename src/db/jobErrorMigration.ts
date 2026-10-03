import type { Database } from "bun:sqlite";
import { errorDetails } from "../schemas/observability";

/** Job errors were free text before they carried an error code. */
export function migrateJobErrors(db: Database) {
  const rows = db
    .query(
      "SELECT id, payload FROM jobs WHERE json_type(payload, '$.error') = 'text'",
    )
    .all() as Array<{ id: string; payload: string }>;
  const update = db.prepare("UPDATE jobs SET payload = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of rows) {
      const job = JSON.parse(row.payload) as { status?: unknown };
      const error = errorDetails(
        job.status === "interrupted" ? "JOB_INTERRUPTED" : "JOB_FAILED",
        { jobId: row.id },
      );
      update.run(JSON.stringify({ ...job, error }), row.id);
    }
  })();
}
