import "../setup";
import { expect, test } from "bun:test";
import { AgentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { setOpenRouterApiKey } from "../../src/db";
import { getDb } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrations";
import { createSessionRow, getMessagesForSession } from "../../src/db/sessions";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
const owner = "11111111-1111-4111-8111-111111111111";
const model = "openrouter:openai/gpt-5.6-terra";
async function until(condition: () => boolean) {
  const end = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("Timed out");
    await Bun.sleep(10);
  }
}
test("restart preserves an interrupted main reply without retrying and repairs child tool history", async () => {
  setOpenRouterApiKey("test");
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), model);
  await workspaceService.provisionRetained(owner, id);
  const first = new AgentRuntime();
  const main = first.main(owner, id);
  main.status = "running";
  main.partial = { role: "assistant", content: "Partial response", steps: [] };
  main.held = true;
  first.store.save(main);
  const child = {
    ...main,
    id: crypto.randomUUID(),
    kind: "general" as const,
    parentId: main.id,
    partial: undefined,
    held: false,
    title: "Recovery",
    history: [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "side-effect",
            function: { name: "bash", arguments: { command: "touch file" } },
          },
        ],
      },
    ],
  };
  first.store.save(child);
  first.store.saveHistory(child, child.history);
  runMigrations(getDb());
  const recovered = new AgentRuntime();
  recovered.recover();
  expect(getMessagesForSession(owner, id)[0]?.content).toContain(
    "Partial response",
  );
  expect(getMessagesForSession(owner, id)[0]?.content).toContain("interrupted");
  expect(recovered.store.get(main.id)?.status).toBe("idle");
  await until(() => recovered.store.get(child.id)?.status === "idle");
  expect(
    recovered.store
      .get(child.id)
      ?.history.find((m) => m.tool_call_id === "side-effect")?.content,
  ).toContain("Check the current state before retrying");
  expect(
    recovered.store.inbox(main.id).filter((m) => m.kind === "result"),
  ).toHaveLength(1);
  expect(getMessagesForSession(owner, id)).toHaveLength(1);
  await recovered.deleteSession(owner, id);
});

test("the automatic wake budget holds updates and a user message resets it", async () => {
  setOpenRouterApiKey("test");
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), model);
  await workspaceService.provisionRetained(owner, id);
  const runtime = new AgentRuntime();
  const main = runtime.main(owner, id);
  main.wakes = 10;
  runtime.store.save(main);
  runtime.enqueue(main, "runtime", "result", "Ready");
  await until(() => runtime.snapshot(owner, id).held);
  expect(runtime.snapshot(owner, id).activation).toBeNull();
  runtime.enqueue(main, "user", "user", "Continue");
  await until(
    () =>
      getMessagesForSession(owner, id).length === 2 &&
      !runtime.snapshot(owner, id).activation,
  );
  expect(runtime.store.get(main.id)?.wakes).toBe(0);
  expect(
    runtime.store.inbox(main.id).every((m) => m.deliveredAt !== null),
  ).toBe(true);
  await runtime.deleteSession(owner, id);
});

test("the scheduler queues the fifth activation and frees its slot when work ends", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("delayed-stream");
  const runtime = new AgentRuntime();
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  try {
    for (const id of ids) {
      createSessionRow(owner, id, Date.now(), model);
      await workspaceService.provisionRetained(owner, id);
    }
    for (const id of ids)
      runtime.enqueue(runtime.main(owner, id), "user", "user", "Run");
    await until(
      () =>
        ids.filter((id) => runtime.snapshot(owner, id).activation).length === 4,
    );
    expect(runtime.main(owner, ids[4]!).status).toBe("queued");
    while (ids.some((id) => runtime.busy(owner, id))) {
      expect(
        ids.filter((id) => runtime.snapshot(owner, id).activation).length,
      ).toBeLessThanOrEqual(4);
      await Bun.sleep(10);
    }
    expect(
      ids.every((id) => getMessagesForSession(owner, id).length === 2),
    ).toBe(true);
  } finally {
    for (const id of ids) await runtime.deleteSession(owner, id);
  }
});
