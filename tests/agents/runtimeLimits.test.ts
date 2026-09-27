import "../setup";
import { expect, spyOn, test } from "bun:test";
import { AgentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { setOpenRouterApiKey } from "../../src/db";
import type { AgentRecord } from "../../src/db/agents";
import { createSessionRow, getMessagesForSession } from "../../src/db/sessions";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import {
  getOpenRouterRequests,
  setOpenRouterScenario,
} from "../helpers/mockOpenRouter";

const owner = "11111111-1111-4111-8111-111111111111";
const model = "openrouter:openai/gpt-5.6-terra";
async function until(condition: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await Bun.sleep(2);
  }
}
async function session(runtime: AgentRuntime) {
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), model);
  await workspaceService.provisionRetained(owner, id);
  setOpenRouterApiKey("test");
  return runtime.main(owner, id);
}
function child(runtime: AgentRuntime, main: AgentRecord): AgentRecord {
  const record: AgentRecord = {
    ...main,
    id: crypto.randomUUID(),
    parentId: main.id,
    kind: "general",
    history: [],
    checkpoints: {},
  };
  runtime.store.save(record);
  return record;
}

test("reports arriving during an activation exhaust the budget and can be delivered later", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  setOpenRouterScenario("delayed-stream");
  try {
    runtime.enqueue(main, "child", "result", "First report");
    await until(() => getOpenRouterRequests().length === 1);
    const activation = runtime.snapshot(owner, main.sessionId).activation?.id;
    for (let n = 1; n < 10; n++) {
      runtime.enqueue(main, "child", "result", `Report ${n}`);
      await until(() => getOpenRouterRequests().length === n + 1);
      expect(runtime.snapshot(owner, main.sessionId).activation?.id).toBe(
        activation,
      );
    }
    const pending = runtime.enqueue(
      main,
      "child",
      "result",
      "Report held for later",
    );
    await until(() => !runtime.snapshot(owner, main.sessionId).activation);
    expect(getOpenRouterRequests()).toHaveLength(10);
    expect(runtime.snapshot(owner, main.sessionId).held).toBe(true);
    expect(runtime.store.undelivered(main.id).map((m) => m.id)).toContain(
      pending.id,
    );
    runtime.deliver(main);
    await until(
      () =>
        getOpenRouterRequests().length === 11 &&
        !runtime.busy(owner, main.sessionId),
    );
    expect(runtime.snapshot(owner, main.sessionId).held).toBe(false);
    expect(runtime.store.undelivered(main.id)).toHaveLength(0);
  } finally {
    await runtime.deleteSession(owner, main.sessionId);
  }
});

test("the budget covers child calls and retains paused follow-ups until the user resumes", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  const worker = child(runtime, main);
  main.automaticTurns = 10;
  runtime.store.save(main);
  try {
    runtime.enqueue(worker, main.id, "message", "New assignment");
    await until(() => runtime.snapshot(owner, main.sessionId).held);
    expect(getOpenRouterRequests()).toHaveLength(0);
    expect(runtime.store.undelivered(worker.id)).toHaveLength(1);
    runtime.enqueue(main, "user", "user", "Continue");
    await until(() =>
      runtime.store.inbox(main.id).some((m) => m.kind === "result"),
    );
    expect(
      runtime.store
        .get(worker.id)
        ?.history.some((m) => m.content.includes("New assignment")),
    ).toBe(true);
    expect(runtime.store.get(main.id)?.automaticTurns).toBeGreaterThan(0);
  } finally {
    await runtime.deleteSession(owner, main.sessionId);
  }
});

test("ready-agent follow-ups queue behind three admitted children", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  const children = Array.from({ length: 4 }, () => child(runtime, main));
  setOpenRouterScenario("delayed-stream");
  try {
    for (const agent of children)
      runtime.enqueue(agent, main.id, "message", "Follow up");
    await until(() => runtime.store.get(children[3]!.id)?.status === "queued");
    expect(
      runtime.store
        .view(owner, main.sessionId)
        .filter((a) => a.kind === "general" && a.status === "running"),
    ).toHaveLength(3);
    await until(() =>
      children.every((a) => runtime.store.get(a.id)?.status === "idle"),
    );
    expect(
      children.every((a) =>
        runtime.store.get(a.id)?.history.some((m) => m.role === "assistant"),
      ),
    ).toBe(true);
  } finally {
    await runtime.deleteSession(owner, main.sessionId);
  }
});

test("waiting children reserve child slots but can receive answers without deadlocking", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  const waiting = Array.from({ length: 3 }, () => child(runtime, main));
  for (const agent of waiting) {
    agent.status = "waiting";
    runtime.store.save(agent);
  }
  const extra = child(runtime, main);
  try {
    runtime.enqueue(extra, main.id, "message", "Wait your turn");
    await until(() => runtime.store.get(extra.id)?.status === "queued");
    runtime.enqueue(waiting[0]!, main.id, "message", "Here is your answer");
    await until(
      () =>
        runtime.store.inbox(main.id).filter((m) => m.kind === "result")
          .length === 2,
    );
    expect(runtime.store.get(extra.id)?.status).toBe("idle");
  } finally {
    await runtime.deleteSession(owner, main.sessionId);
  }
});

test("removing queued input reconciles status only when the last runnable message is gone", async () => {
  const runtime = new AgentRuntime();
  const mains: AgentRecord[] = [];
  for (let n = 0; n < 5; n++) mains.push(await session(runtime));
  setOpenRouterScenario("delayed-stream");
  try {
    for (const main of mains) runtime.enqueue(main, "user", "user", "Run");
    const queued = mains[4]!;
    await until(() => runtime.store.get(queued.id)?.status === "queued");
    const second = runtime.enqueue(queued, "user", "user", "Another message");
    const first = runtime.store.undelivered(queued.id)[0]!;
    expect(runtime.removeQueued(queued, first.id)).toBe(true);
    expect(runtime.store.get(queued.id)?.status).toBe("queued");
    expect(runtime.removeQueued(queued, second.id)).toBe(true);
    expect(runtime.busy(owner, queued.sessionId)).toBe(false);
    expect(runtime.removeQueued(queued, second.id)).toBe(false);
    await until(() => mains.every((a) => !runtime.busy(owner, a.sessionId)));
    expect(getMessagesForSession(owner, queued.sessionId)).toHaveLength(0);
  } finally {
    for (const main of mains)
      await runtime.deleteSession(owner, main.sessionId);
  }
});

test("failed initial-prompt persistence rolls back the spawned agent", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  setOpenRouterScenario("async-agents");
  const enqueue = runtime.store.enqueue.bind(runtime.store);
  const fault = spyOn(runtime.store, "enqueue").mockImplementation(
    (message) => {
      if (message.kind === "task") throw new Error("Injected inbox failure");
      return enqueue(message);
    },
  );
  try {
    runtime.enqueue(main, "user", "user", "Create a helper");
    await until(
      () =>
        getMessagesForSession(owner, main.sessionId).length === 2 &&
        !runtime.busy(owner, main.sessionId),
    );
    expect(runtime.store.list(owner, main.sessionId)).toHaveLength(1);
    expect(
      runtime.store
        .get(main.id)
        ?.history.some(
          (m) =>
            m.role === "tool" && m.content.includes("Injected inbox failure"),
        ),
    ).toBe(true);
  } finally {
    fault.mockRestore();
    await runtime.deleteSession(owner, main.sessionId);
  }
});

for (const target of ["main", "child"] as const)
  test(`${target} tool continuations do not spend the automatic-turn budget`, async () => {
    const runtime = new AgentRuntime();
    const main = await session(runtime);
    const worker = child(runtime, main);
    setOpenRouterScenario("endless-tools");
    try {
      if (target === "main")
        runtime.send(main, {
          content: "Work until finished",
          model,
          attachmentIds: [],
        });
      else runtime.enqueue(worker, main.id, "message", "Work until finished");
      await until(() => getOpenRouterRequests().length > 15);
      // Only the child's delivery from Euler is automatic; user input is exempt.
      expect(runtime.store.get(main.id)?.automaticTurns).toBe(
        target === "main" ? 0 : 1,
      );
      expect(runtime.snapshot(owner, main.sessionId).held).toBe(false);
    } finally {
      await runtime.deleteSession(owner, main.sessionId);
    }
  });

test("a blocking spawn does not prevent answering children that occupy all child slots", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  for (let n = 0; n < 3; n++) {
    const agent = child(runtime, main);
    agent.status = "waiting";
    runtime.store.save(agent);
  }
  setOpenRouterScenario("blocking-agent");
  try {
    runtime.enqueue(main, "user", "user", "Create another helper");
    await until(
      () =>
        getMessagesForSession(owner, main.sessionId).length === 2 &&
        !runtime.snapshot(owner, main.sessionId).activation,
    );
    expect(
      runtime.store
        .view(owner, main.sessionId)
        .filter((a) => a.kind === "general" && a.status === "queued"),
    ).toHaveLength(1);
    const spawned = runtime.store
      .get(main.id)
      ?.history.find(
        (m) => m.role === "tool" && m.content.includes('"status":"queued"'),
      );
    // The child's activity is still its prompt, which is not a result.
    expect(JSON.parse(spawned!.content)).not.toHaveProperty("result");
  } finally {
    await runtime.deleteSession(owner, main.sessionId);
  }
});

test("stopping a waiting subagent withdraws its unanswered question", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  const waiting = child(runtime, main);
  waiting.status = "waiting";
  runtime.store.save(waiting);
  try {
    runtime.enqueue(main, waiting.id, "question", "May I proceed?");
    // Hold it before the scheduler runs, so the main agent does not answer.
    runtime.store.hold(main.id, true);
    await runtime.cancel(waiting);
    expect(runtime.store.get(waiting.id)?.status).toBe("cancelled");
    expect(
      runtime.store.undelivered(main.id).some((m) => m.kind === "question"),
    ).toBe(false);
  } finally {
    await runtime.deleteSession(owner, main.sessionId);
  }
});
