import "../setup";
import { expect, spyOn, test } from "bun:test";
import fs from "node:fs/promises";
import { agentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { createSessionRow, getSessionById } from "../../src/db/sessions";
import { deleteExpiredSessions } from "../../src/sessions/lifecycle";
import { workspaceService } from "../../src/workspaces/WorkspaceService";

const owner = "11111111-1111-4111-8111-111111111111";

async function chat(expiresAt: number | null) {
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), null, expiresAt);
  const workspace = await workspaceService.provisionRetained(owner, id);
  await fs.writeFile(`${workspace.hostPath}/output.txt`, "output");
  return { id, hostPath: workspace.hostPath };
}

test("expiry hard-deletes idle expired chats and leaves busy, unexpired, and saved chats", async () => {
  const now = Date.now();
  const expired = await chat(now - 1);
  const busy = await chat(now - 1);
  const unexpired = await chat(now + 60_000);
  const saved = await chat(null);
  const trashed = await fs.readdir(workspaceService.trashRoot);
  const working = spyOn(agentRuntime, "busy").mockImplementation(
    (_owner, sessionId) => sessionId === busy.id,
  );
  try {
    await deleteExpiredSessions(now);
  } finally {
    working.mockRestore();
  }

  expect(getSessionById(owner, expired.id)).toBeNull();
  await expect(fs.access(expired.hostPath)).rejects.toThrow();
  expect(await fs.readdir(workspaceService.trashRoot)).toEqual(trashed);
  for (const kept of [busy, unexpired, saved]) {
    expect(getSessionById(owner, kept.id)).not.toBeNull();
    await fs.access(`${kept.hostPath}/output.txt`);
  }

  await deleteExpiredSessions(now);
  expect(getSessionById(owner, busy.id)).toBeNull();
});
