import "../setup";
import { expect, spyOn, test } from "bun:test";
import { AgentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { setOpenRouterApiKey } from "../../src/db";
import { AgentStore } from "../../src/db/agents";
import { getDb } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrations";
import { createSessionRow, getMessagesForSession } from "../../src/db/sessions";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import {
  getOpenRouterRequests,
  setOpenRouterScenario,
} from "../helpers/mockOpenRouter";
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
  first.store.save(main);
  first.store.saveReply(main, "Partial response");
  const step = { kind: "llm_call", status: "running", turnIndex: 0 };
  first.store.saveStep(main, "activation", 0, step);
  const child = {
    ...main,
    id: crypto.randomUUID(),
    kind: "general" as const,
    parentId: main.id,
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
  // The step a restart cut off is shown as failed, not running forever.
  expect(getMessagesForSession(owner, id)[0]?.steps).toMatchObject([
    { ...step, status: "error", error: "Interrupted by server restart" },
  ]);
  expect(recovered.store.steps(main.id)).toEqual([]);
  expect(recovered.store.get(main.id)?.status).toBe("idle");
  expect(recovered.store.get(child.id)?.status).toBe("idle");
  expect(new AgentStore().get(child.id)?.interruption).toContain(
    "server restart",
  );
  await Bun.sleep(30);
  expect(getOpenRouterRequests()).toHaveLength(0);
  expect(
    recovered.store
      .get(child.id)
      ?.history.find((m) => m.tool_call_id === "side-effect")?.content,
  ).toContain("Check the current state before retrying");
  expect(
    recovered.store.inbox(main.id).filter((m) => m.kind === "result"),
  ).toHaveLength(0);
  expect(getMessagesForSession(owner, id)).toHaveLength(1);
  recovered.enqueue(
    recovered.store.get(child.id)!,
    main.id,
    "message",
    "Different work now",
  );
  await until(() =>
    recovered.store.inbox(main.id).some((m) => m.kind === "result"),
  );
  expect(
    recovered.store
      .get(child.id)
      ?.history.some((m) => m.tool_call_id === "side-effect"),
  ).toBe(true);
  expect(
    recovered.store
      .get(child.id)
      ?.history.some(
        (m) =>
          m.content === "Different work now" ||
          m.content.includes("Different work now"),
      ),
  ).toBe(true);
  expect(recovered.store.get(child.id)?.interruption).toBeUndefined();
  await recovered.deleteSession(owner, id);
});

test("the automatic-turn budget holds updates and a user message resets it", async () => {
  setOpenRouterApiKey("test");
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), model);
  await workspaceService.provisionRetained(owner, id);
  const runtime = new AgentRuntime();
  const main = runtime.main(owner, id);
  main.automaticTurns = 10;
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
  expect(runtime.store.get(main.id)?.automaticTurns).toBe(0);
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

test("restart retains queued and waiting agents and their input without starting work", async () => {
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), model);
  await workspaceService.provisionRetained(owner, id);
  const first = new AgentRuntime();
  const main = first.main(owner, id);
  const children = (["queued", "waiting", "idle"] as const).map((status) => {
    const agent = {
      ...main,
      id: crypto.randomUUID(),
      parentId: main.id,
      kind: "general" as const,
      status,
    };
    first.store.save(agent);
    first.store.enqueue({
      agentId: agent.id,
      sender: main.id,
      kind: "message",
      content: `Old input for ${status}`,
      wakes: true,
      attachmentIds: [],
    });
    return agent;
  });
  const asking = {
    ...main,
    id: crypto.randomUUID(),
    parentId: main.id,
    kind: "general" as const,
    status: "waiting" as const,
  };
  first.store.save(asking);
  first.store.enqueue({
    agentId: main.id,
    sender: "user",
    kind: "user",
    content: "Queued user input",
    wakes: true,
    attachmentIds: [],
  });
  const recovered = new AgentRuntime();
  try {
    recovered.recover();
    recovered.recover();
    await Bun.sleep(30);
    expect(getOpenRouterRequests()).toHaveLength(0);
    expect(recovered.snapshot(owner, id).held).toBe(true);
    for (const child of children) {
      const agent = recovered.store.get(child.id)!;
      expect(agent.status).toBe("idle");
      expect(agent.endedAt).toBeNull();
      expect(
        agent.history.filter((m) => m.content.includes("Old input")),
      ).toHaveLength(1);
      expect(
        agent.history.filter((m) =>
          m.content.includes("Ready for new instructions"),
        ),
      ).toHaveLength(1);
      expect(recovered.store.undelivered(agent.id)).toHaveLength(0);
    }
    // Waiting with nothing pending was never interrupted: it still awaits its answer.
    const stillAsking = recovered.store.get(asking.id)!;
    expect(stillAsking.status).toBe("waiting");
    expect(stillAsking.interruption).toBeUndefined();
    expect(stillAsking.history).toHaveLength(main.history.length);
    setOpenRouterApiKey("test");
    recovered.enqueue(
      recovered.store.get(children[0]!.id)!,
      main.id,
      "message",
      "A different assignment",
    );
    await until(() =>
      recovered.store.inbox(main.id).some((m) => m.kind === "result"),
    );
  } finally {
    await recovered.deleteSession(owner, id);
  }
});

test("recovery rolls back transcript and state together if persistence fails", async () => {
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), model);
  const first = new AgentRuntime();
  const main = first.main(owner, id);
  main.status = "running";
  first.store.save(main);
  first.store.saveReply(main, "Partial reply");
  const recovered = new AgentRuntime();
  const fault = spyOn(recovered.store, "saveHistory").mockImplementation(() => {
    throw new Error("Injected recovery failure");
  });
  try {
    expect(() => recovered.recover()).toThrow("Injected recovery failure");
    expect(getMessagesForSession(owner, id)).toHaveLength(0);
    expect(new AgentStore().get(main.id)?.status).toBe("running");
    fault.mockRestore();
    recovered.recover();
    recovered.recover();
    expect(getMessagesForSession(owner, id)).toHaveLength(1);
    expect(new AgentStore().get(main.id)?.status).toBe("idle");
  } finally {
    fault.mockRestore();
    await recovered.deleteSession(owner, id);
  }
});

test("restart loads only agents with work to recover", async () => {
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), model);
  const store = new AgentStore();
  const runtime = new AgentRuntime();
  const main = runtime.main(owner, id);
  const agent = (kind: "main" | "general", status: "idle" | "waiting") => {
    const record = { ...main, id: crypto.randomUUID(), kind, status };
    store.save(record);
    return record;
  };
  // A ready subagent's steps are its trace, not an open reply.
  const traced = agent("general", "idle");
  store.saveStep(traced, "activation", 0, {
    kind: "complete",
    status: "done",
    turnIndex: 0,
  });
  agent("general", "waiting");
  const pending = agent("general", "idle");
  store.enqueue({
    agentId: pending.id,
    sender: main.id,
    kind: "message",
    content: "Follow-up",
    wakes: true,
    attachmentIds: [],
  });
  const replying = agent("main", "idle");
  store.saveReply(replying, "Partial");
  const recovering = new AgentStore()
    .interrupted()
    .filter((a) => a.sessionId === id)
    .map((a) => a.id);
  expect(recovering).toEqual([pending.id, replying.id]);
  await runtime.deleteSession(owner, id);
});
