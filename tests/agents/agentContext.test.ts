import { expect, test } from "bun:test";
import { pendingSummary } from "../../src/agents/runtime/agentContext";
import { createAgentRecord } from "../../src/db/agentRecord";

const agent = (
  title: string,
  status: "running" | "idle",
  interruption?: string,
) => ({
  ...createAgentRecord({
    ownerUuid: "owner",
    sessionId: "chat",
    parentId: "main",
    kind: "general",
    title,
    status,
    model: "model",
    spawnPosition: 0,
    activity: `${title} activity`,
    config: {},
  }),
  interruption,
});

test("the summary leaves out ready agents' delivered results", () => {
  const summary = pendingSummary([
    agent("Working", "running"),
    agent("Ready", "idle"),
    agent("Restarted", "idle", "Interrupted by server restart."),
  ]);
  expect(summary).toContain("latest: Working activity");
  expect(summary).toContain("Ready · ready for follow-ups");
  expect(summary).not.toContain("Ready activity");
  expect(summary).toContain("latest: Restarted activity");
});
