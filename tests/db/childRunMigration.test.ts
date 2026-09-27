import "../env-setup";
import { expect, test } from "bun:test";
import { getDb } from "../../src/db";
import { AgentStore } from "../../src/db/agents";
import { migrateChildRuns } from "../../src/db/childRunMigration";
import {
  appendRuntimeMessage,
  createSessionRow,
  getMessagesForSession,
} from "../../src/db/sessions";

test("legacy nested subagent runs become ended agents and leave the transcript", () => {
  const ownerUuid = "00000000-0000-4000-8000-000000000004";
  const sessionId = "child-run-migration";
  createSessionRow(ownerUuid, sessionId, 1, "test-model");
  const subagentStep = (prompt: string, steps: unknown[] = []) => ({
    kind: "tool_call",
    toolName: "run_subagent",
    result: `${prompt} done`,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:05.000Z",
    childRun: { agentName: "subagent", prompt, steps },
  });
  appendRuntimeMessage(ownerUuid, sessionId, { role: "user", content: "Go" });
  appendRuntimeMessage(ownerUuid, sessionId, {
    role: "assistant",
    content: "Done",
    steps: [
      subagentStep("Survey the repo\nwith detail", [
        { kind: "llm_call", agentName: "subagent" },
        subagentStep("Nested"),
      ]),
    ],
    versions: [{ content: "Older", steps: [subagentStep("Replaced")] }],
  });

  migrateChildRuns(getDb());
  migrateChildRuns(getDb());

  const agents = new AgentStore().list(ownerUuid, sessionId);
  expect(agents).toHaveLength(3);
  const byTitle = (title: string) => agents.find((a) => a.title === title)!;
  const survey = byTitle("Survey the repo");
  expect(survey).toMatchObject({
    kind: "general",
    status: "completed",
    parentId: null,
    model: "test-model",
    spawnPosition: 1,
    activity: "Survey the repo\nwith detail done",
    createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
    endedAt: Date.parse("2026-01-01T00:00:05.000Z"),
  });
  const steps = new AgentStore().steps(survey.id);
  expect(steps).toHaveLength(2);
  expect(JSON.stringify(steps)).not.toContain("childRun");
  expect(byTitle("Nested")).toMatchObject({
    parentId: survey.id,
    spawnPosition: -1,
  });
  expect(byTitle("Replaced").spawnPosition).toBe(-1);
  expect(
    new AgentStore().inbox(survey.id).map((m) => [m.kind, m.content]),
  ).toEqual([["task", "Survey the repo\nwith detail"]]);

  const reply = getMessagesForSession(ownerUuid, sessionId)[1]!;
  expect(JSON.stringify(reply)).not.toContain("childRun");
  expect(reply.steps).toMatchObject([
    {
      toolName: "run_subagent",
      result: "Survey the repo\nwith detail done",
    },
  ]);
});
