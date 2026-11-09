import "../setup";
import { expect, test } from "bun:test";
import { agentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { setOpenRouterApiKey } from "../../src/db";
import { getMessagesForSession } from "../../src/db/sessions";
import { Step_Kind } from "../../src/gen/euler/v1/steps_pb";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { Code, rpc, rpcCode } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";

const model = "openrouter:openai/gpt-5.6-terra";
async function until(condition: () => boolean) {
  const end = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("Timed out");
    await Bun.sleep(10);
  }
}
test("server-owned turns queue input at boundaries and survive client disconnection", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("delayed-stream");
  const api = rpc();
  let id = "";
  try {
    id = (await api.sessions.createSession({ model })).id;
    const send = (content: string) =>
      api.agent.sendMessage({ sessionId: id, content, settings: { model } });
    expect((await send("First")).queued).toBe(false);
    await until(() =>
      Boolean(agentRuntime.snapshot(TEST_USER_ID, id).activation?.content),
    );
    expect((await send("Second")).queued).toBe(true);
    await until(
      () =>
        getMessagesForSession(TEST_USER_ID, id).length === 4 &&
        !agentRuntime.snapshot(TEST_USER_ID, id).activation,
    );
    expect(getMessagesForSession(TEST_USER_ID, id).map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    // A chat without subagents never receives a subagent summary.
    expect(
      agentRuntime.store
        .list(TEST_USER_ID, id)
        .find((a) => a.kind === "main")
        ?.history.some((m) => m.content.includes("<background_agents>")),
    ).toBe(false);
    expect(await rpcCode(send("   "))).toBe(Code.InvalidArgument);
    expect(
      await rpcCode(
        rpc("22222222-2222-4222-8222-222222222222").agent.getRuntime({
          sessionId: id,
        }),
      ),
    ).toBe(Code.NotFound);
  } finally {
    if (id) await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
});

for (const scenario of [
  "async-agents",
  "agent-question",
  "blocking-question",
] as const) {
  test(`${scenario}: durable child wakes the parent without another user message`, async () => {
    setOpenRouterApiKey("test");
    setOpenRouterScenario(scenario);
    const api = rpc();
    const { id } = await api.sessions.createSession({ model });
    try {
      await api.agent.sendMessage({
        sessionId: id,
        content: "Research this",
        settings: { model },
      });
      await until(
        () =>
          getMessagesForSession(TEST_USER_ID, id).some(
            (m) => m.content === "The background result is 42.",
          ) && !agentRuntime.busy(TEST_USER_ID, id),
      );
      const agents = agentRuntime.store.list(TEST_USER_ID, id);
      expect(agents.find((a) => a.kind === "general")?.status).toBe("idle");
      expect(
        getMessagesForSession(TEST_USER_ID, id).filter(
          (m) => m.role === "user",
        ),
      ).toHaveLength(1);
      const main = agents.find((a) => a.kind === "main")!;
      expect(
        agentRuntime.store.inbox(main.id).find((m) => m.kind === "result")
          ?.deliveredAt,
      ).toBeNumber();
      if (scenario !== "async-agents")
        expect(
          agentRuntime.store.inbox(main.id).some((m) => m.kind === "question"),
        ).toBe(true);
      // An unchanged subagent summary is not sent again on the next turn.
      const summaries = () =>
        agentRuntime.store
          .get(main.id)!
          .history.filter((m) => m.content.startsWith("<background_agents>"))
          .length;
      const sent = summaries();
      const before = getMessagesForSession(TEST_USER_ID, id).length;
      await api.agent.sendMessage({
        sessionId: id,
        content: "Thanks",
        settings: { model },
      });
      await until(
        () =>
          getMessagesForSession(TEST_USER_ID, id).length === before + 2 &&
          !agentRuntime.busy(TEST_USER_ID, id),
      );
      expect(summaries()).toBe(sent);
    } finally {
      await agentRuntime.deleteSession(TEST_USER_ID, id);
    }
  });
}

test("a result arriving after Stop wakes the parent and does not cancel the child", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("async-agents");
  const api = rpc();
  const { id } = await api.sessions.createSession({ model });
  try {
    await api.agent.sendMessage({
      sessionId: id,
      content: "Research",
      settings: { model },
    });
    await until(
      () =>
        agentRuntime.store
          .list(TEST_USER_ID, id)
          .some((a) => a.kind === "general") &&
        !agentRuntime.snapshot(TEST_USER_ID, id).activation,
    );
    await api.agent.stop({ sessionId: id });
    await until(() =>
      agentRuntime.store
        .list(TEST_USER_ID, id)
        .some((a) => a.kind === "general" && a.status === "idle"),
    );
    expect(agentRuntime.snapshot(TEST_USER_ID, id).held).toBe(false);
    await until(
      () =>
        getMessagesForSession(TEST_USER_ID, id).length === 3 &&
        !agentRuntime.busy(TEST_USER_ID, id),
    );
    expect(getMessagesForSession(TEST_USER_ID, id).at(-1)?.content).toContain(
      "42",
    );
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
});

test("user cancellation ends a child without a result or an automatic reply", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("async-agents");
  const api = rpc();
  const { id } = await api.sessions.createSession({ model });
  try {
    await api.agent.sendMessage({
      sessionId: id,
      content: "Research",
      settings: { model },
    });
    await until(() =>
      agentRuntime.store
        .list(TEST_USER_ID, id)
        .some((a) => a.kind === "general"),
    );
    const child = agentRuntime.store
      .list(TEST_USER_ID, id)
      .find((a) => a.kind === "general")!;
    await api.agent.cancelAgent({ sessionId: id, agentId: child.id });
    await until(() => !agentRuntime.busy(TEST_USER_ID, id));
    expect(agentRuntime.store.get(child.id)?.status).toBe("cancelled");
    expect(
      agentRuntime.store
        .inbox(child.parentId!)
        .some((m) => m.kind === "result"),
    ).toBe(false);
    expect(getMessagesForSession(TEST_USER_ID, id)).toHaveLength(2);
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
});

test("a ready child keeps its context for follow-ups until it is dismissed", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("async-agents");
  const api = rpc();
  const { id } = await api.sessions.createSession({ model });
  const results = (mainId: string) =>
    agentRuntime.store
      .inbox(mainId)
      .filter((m) => m.kind === "result" && m.deliveredAt !== null).length;
  try {
    await api.agent.sendMessage({
      sessionId: id,
      content: "Research",
      settings: { model },
    });
    const agents = () => agentRuntime.store.list(TEST_USER_ID, id);
    await until(
      () =>
        agents().some((a) => a.kind === "general" && a.status === "idle") &&
        !agentRuntime.busy(TEST_USER_ID, id),
    );
    const main = agents().find((a) => a.kind === "main")!;
    const child = agents().find((a) => a.kind === "general")!;
    expect(child.endedAt).toBeNull();
    await until(() => results(main.id) === 1);

    agentRuntime.enqueue(child, main.id, "message", "Double-check it");
    await until(
      () => results(main.id) === 2 && !agentRuntime.busy(TEST_USER_ID, id),
    );
    const followedUp = agentRuntime.store.get(child.id)!;
    expect(followedUp.status).toBe("idle");
    expect(
      followedUp.history.filter((m) => m.role === "assistant"),
    ).toHaveLength(2);
    // The trace spans both activations and is served only with the agent detail.
    const detail = await api.agent.getAgent({
      sessionId: id,
      agentId: child.id,
    });
    expect(detail.agent).not.toHaveProperty("steps");
    expect(
      detail.steps.filter((s) => s.kind === Step_Kind.LLM_CALL),
    ).toHaveLength(2);
    // Another user's chat, and the main agent, cannot be cancelled this way.
    expect(
      await rpcCode(api.agent.cancelAgent({ sessionId: id, agentId: main.id })),
    ).toBe(Code.NotFound);

    await api.agent.cancelAgent({ sessionId: id, agentId: child.id });
    const dismissed = agentRuntime.store.get(child.id)!;
    expect(dismissed.status).toBe("completed");
    expect(dismissed.endedAt).toBeNumber();
    expect(dismissed.activity).toBe(followedUp.activity);
    expect(() =>
      agentRuntime.enqueue(dismissed, main.id, "message", "Again"),
    ).toThrow("no longer accepting messages");
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
});

test("rewinding keeps reports from subagents that stay in the conversation", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("async-agents");
  const api = rpc();
  const { id } = await api.sessions.createSession({ model });
  const agents = () => agentRuntime.store.list(TEST_USER_ID, id);
  const users = () =>
    getMessagesForSession(TEST_USER_ID, id).filter((m) => m.role === "user");
  try {
    await api.agent.sendMessage({
      sessionId: id,
      content: "Research",
      settings: { model },
    });
    await until(
      () =>
        getMessagesForSession(TEST_USER_ID, id).some(
          (m) => m.content === "The background result is 42.",
        ) && !agentRuntime.busy(TEST_USER_ID, id),
    );
    await api.agent.sendMessage({
      sessionId: id,
      content: "Second",
      settings: { model },
    });
    await until(
      () => users().length === 2 && !agentRuntime.busy(TEST_USER_ID, id),
    );
    const main = agents().find((a) => a.kind === "main")!;
    const child = agents().find((a) => a.kind === "general")!;
    const position = getMessagesForSession(TEST_USER_ID, id).findIndex(
      (m) => m.content === "Second",
    );

    // The child reports while the rewind is in progress.
    const rewound = agentRuntime.rewind(TEST_USER_ID, id, { position });
    agentRuntime.enqueue(main, child.id, "result", "Late result");
    await rewound;
    await until(
      () =>
        agentRuntime.store
          .get(main.id)!
          .history.some((m) => String(m.content).includes("Late result")) &&
        !agentRuntime.busy(TEST_USER_ID, id),
    );
    expect(agentRuntime.store.get(child.id)?.status).toBe("idle");
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
});

test("a blocking spawn returns the child's result to the same reply", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("blocking-agent");
  const api = rpc();
  const { id } = await api.sessions.createSession({ model });
  try {
    await api.agent.sendMessage({
      sessionId: id,
      content: "Research",
      settings: { model },
    });
    await until(
      () =>
        getMessagesForSession(TEST_USER_ID, id).length === 2 &&
        !agentRuntime.busy(TEST_USER_ID, id),
    );
    const main = agentRuntime.store
      .list(TEST_USER_ID, id)
      .find((a) => a.kind === "main")!;
    const spawned = main.history.find(
      (m) => m.role === "tool" && m.content.includes("agentId"),
    );
    expect(JSON.parse(spawned!.content)).toMatchObject({
      status: "idle",
      result: "42",
    });
    // The spawn returned the result, so it is not delivered a second time.
    expect(main.history.some((m) => m.content.includes('kind="result"'))).toBe(
      false,
    );
    expect(
      agentRuntime.store.inbox(main.id).find((m) => m.kind === "result")
        ?.deliveredAt,
    ).toBeNumber();
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
});

test("Stop holds input already queued until Deliver, and invalid rewind is rejected", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("delayed-stream");
  const api = rpc();
  const { id } = await api.sessions.createSession({ model });
  try {
    await api.agent.sendMessage({
      sessionId: id,
      content: "First",
      settings: { model },
    });
    await until(() =>
      Boolean(agentRuntime.snapshot(TEST_USER_ID, id).activation?.content),
    );
    await api.agent.sendMessage({
      sessionId: id,
      content: "Queued",
      settings: { model },
    });
    await api.agent.stop({ sessionId: id });
    expect(agentRuntime.snapshot(TEST_USER_ID, id).held).toBe(true);
    expect(agentRuntime.snapshot(TEST_USER_ID, id).activation).toBeNull();
    expect(
      agentRuntime.snapshot(TEST_USER_ID, id).queued.map((m) => m.content),
    ).toEqual(["Queued"]);
    expect(
      await rpcCode(api.agent.rewind({ sessionId: id, position: 99 })),
    ).toBe(Code.InvalidArgument);
    await api.agent.deliver({ sessionId: id });
    await until(
      () =>
        !agentRuntime.snapshot(TEST_USER_ID, id).activation &&
        agentRuntime.snapshot(TEST_USER_ID, id).queued.length === 0,
    );
    expect(
      getMessagesForSession(TEST_USER_ID, id)
        .filter((m) => m.role === "user")
        .map((m) => m.content),
    ).toEqual(["First", "Queued"]);
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
});

for (const ephemeral of [false, true])
  test(`deleting ${ephemeral ? "an ephemeral" : "a saved"} chat settles its main and child activations before deleting it`, async () => {
    setOpenRouterApiKey("test");
    setOpenRouterScenario("async-agents");
    const api = rpc();
    const { id } = await api.sessions.createSession({ model, ephemeral });
    try {
      await api.agent.sendMessage({
        sessionId: id,
        content: "Research",
        settings: { model },
      });
      await until(() =>
        agentRuntime.store
          .list(TEST_USER_ID, id)
          .some((a) => a.kind === "general" && a.status === "running"),
      );
      await api.sessions.deleteSession({ id });
      expect(agentRuntime.store.list(TEST_USER_ID, id)).toEqual([]);
      expect(await rpcCode(api.agent.getRuntime({ sessionId: id }))).toBe(
        Code.NotFound,
      );
    } finally {
      await agentRuntime.deleteSession(TEST_USER_ID, id);
    }
  });
