import type { Database } from "bun:sqlite";
import { DEFAULT_RUN_MODEL } from "../constants";

type Step = Record<string, unknown>;
type Row = {
  id: number;
  session_id: string;
  position: number;
  steps: string | null;
  versions: string | null;
  owner_uuid: string;
  model: string | null;
};

const stepList = (value: unknown): Step[] =>
  Array.isArray(value)
    ? value.filter((s): s is Step => typeof s === "object" && s !== null)
    : [];
const text = (value: unknown) => (typeof value === "string" ? value : "");
const time = (value: unknown) => Date.parse(text(value)) || null;

/**
 * `run_subagent` nested each subagent's run under its tool step's `childRun`.
 * Each becomes an ended agent, so old traces open like durable subagents.
 */
export function migrateChildRuns(db: Database) {
  const rows = db
    .query(
      `SELECT m.id, m.session_id, m.position, m.steps, m.versions, s.owner_uuid, s.model
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE m.steps LIKE '%"childRun"%' OR m.versions LIKE '%"childRun"%'`,
    )
    .all() as Row[];
  const insertAgent = db.prepare(
    "INSERT INTO agents (id, session_id, status, data) VALUES (?, ?, 'completed', ?)",
  );
  const insertTask = db.prepare(
    "INSERT INTO agent_messages (agent_id, sender, kind, content, wakes, created_at, delivered_at) VALUES (?, 'runtime', 'task', ?, 1, ?, ?)",
  );
  const update = db.prepare(
    "UPDATE messages SET steps = ?, versions = ? WHERE id = ?",
  );
  db.transaction(() => {
    for (const row of rows) {
      let steps: unknown;
      let versions: unknown;
      try {
        steps = row.steps ? JSON.parse(row.steps) : null;
        versions = row.versions ? JSON.parse(row.versions) : null;
      } catch {
        // Leave malformed historical entries untouched for manual recovery.
        continue;
      }
      const extract = (
        list: Step[],
        spawnPosition: number,
        parentId: string | null,
      ): Step[] =>
        list.map(({ childRun, ...step }) => {
          if (typeof childRun !== "object" || childRun === null) return step;
          const run = childRun as Step;
          const id = crypto.randomUUID();
          const prompt = text(run.prompt);
          const createdAt = time(step.startedAt) ?? Date.now();
          insertAgent.run(
            id,
            row.session_id,
            JSON.stringify({
              id,
              sessionId: row.session_id,
              ownerUuid: row.owner_uuid,
              parentId,
              kind: "general",
              title:
                prompt
                  .split("\n")
                  .find((line) => line.trim())
                  ?.trim()
                  .slice(0, 80) || "Subagent",
              model: row.model ?? DEFAULT_RUN_MODEL,
              spawnPosition,
              createdAt,
              endedAt: time(step.endedAt) ?? createdAt,
              activity: text(step.result),
              steps: extract(stepList(run.steps), -1, id),
              held: false,
              wakes: 0,
              checkpoints: {},
              lastSummaryAt: 0,
              config: {},
            }),
          );
          if (prompt) insertTask.run(id, prompt, createdAt, createdAt);
          return step;
        });
      update.run(
        steps === null
          ? row.steps
          : JSON.stringify(extract(stepList(steps), row.position, null)),
        Array.isArray(versions)
          ? JSON.stringify(
              versions.map((version: Step) =>
                Array.isArray(version.steps)
                  ? {
                      ...version,
                      steps: extract(stepList(version.steps), -1, null),
                    }
                  : version,
              ),
            )
          : row.versions,
        row.id,
      );
    }
  })();
}
