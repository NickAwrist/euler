import "../setup";
import { expect, test } from "bun:test";
import { agentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { setOpenRouterApiKey } from "../../src/db";
import { getMessagesForSession } from "../../src/db/sessions";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { TEST_USER_ID, startTestServer, userHeaders } from "../helpers/server";

const model = "openrouter:openai/gpt-5.6-terra";
async function until(condition: () => boolean) {
  const end = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("Timed out");
    await Bun.sleep(10);
  }
}
test("server-owned turns queue input at boundaries and survive HTTP disconnection", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("delayed-stream");
  const { url, close } = await startTestServer();
  const headers = userHeaders(undefined, {
    "Content-Type": "application/json",
  });
  const post = (path: string, json: unknown) =>
    fetch(url + path, { method: "POST", headers, body: JSON.stringify(json) });
  let id = "";
  try {
    const created = await post("/api/sessions", { model });
    id = ((await created.json()) as { id: string }).id;
    expect(
      (await post(`/api/sessions/${id}/messages`, { content: "First", model }))
        .status,
    ).toBe(202);
    await until(() =>
      Boolean(agentRuntime.snapshot(TEST_USER_ID, id).activation?.content),
    );
    expect(
      (await post(`/api/sessions/${id}/messages`, { content: "Second", model }))
        .status,
    ).toBe(202);
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
    expect(
      (
        await post(`/api/sessions/${id}/messages`, {
          content: "Spoof",
          history: [],
        })
      ).status,
    ).toBe(400);
    const other = await fetch(`${url}/api/sessions/${id}/runtime`, {
      headers: userHeaders("22222222-2222-4222-8222-222222222222"),
    });
    expect(other.status).toBe(404);
    expect((await post("/api/runs", {})).status).toBe(404);
  } finally {
    if (id) await agentRuntime.deleteSession(TEST_USER_ID, id);
    await close();
  }
});

for (const scenario of ["async-agents", "agent-question"] as const) {
  test(`${scenario}: durable child wakes the parent without another user message`, async () => {
    setOpenRouterApiKey("test");
    setOpenRouterScenario(scenario);
    const { url, close } = await startTestServer();
    const headers = userHeaders(undefined, {
      "Content-Type": "application/json",
    });
    const created = await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model }),
    });
    const { id } = (await created.json()) as { id: string };
    try {
      expect(
        (
          await fetch(`${url}/api/sessions/${id}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({ content: "Research this", model }),
          })
        ).status,
      ).toBe(202);
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
      if (scenario === "agent-question")
        expect(
          agentRuntime.store.inbox(main.id).some((m) => m.kind === "question"),
        ).toBe(true);
    } finally {
      await agentRuntime.deleteSession(TEST_USER_ID, id);
      await close();
    }
  });
}

test("a result arriving after Stop wakes the parent and does not cancel the child", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("async-agents");
  const { url, close } = await startTestServer();
  const headers = userHeaders(undefined, {
    "Content-Type": "application/json",
  });
  const post = (path: string, body = {}) =>
    fetch(url + path, { method: "POST", headers, body: JSON.stringify(body) });
  const created = await post("/api/sessions", { model });
  const { id } = (await created.json()) as { id: string };
  try {
    await post(`/api/sessions/${id}/messages`, { content: "Research", model });
    await until(
      () =>
        agentRuntime.store
          .list(TEST_USER_ID, id)
          .some((a) => a.kind === "general") &&
        !agentRuntime.snapshot(TEST_USER_ID, id).activation,
    );
    await post(`/api/sessions/${id}/stop`);
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
    await close();
  }
});

test("user cancellation ends a child without a result or an automatic reply", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("async-agents");
  const { url, close } = await startTestServer();
  const headers = userHeaders(undefined, {
    "Content-Type": "application/json",
  });
  const created = await fetch(`${url}/api/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model }),
  });
  const { id } = (await created.json()) as { id: string };
  try {
    await fetch(`${url}/api/sessions/${id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "Research", model }),
    });
    await until(() =>
      agentRuntime.store
        .list(TEST_USER_ID, id)
        .some((a) => a.kind === "general"),
    );
    const child = agentRuntime.store
      .list(TEST_USER_ID, id)
      .find((a) => a.kind === "general")!;
    expect(
      (
        await fetch(`${url}/api/sessions/${id}/agents/${child.id}/cancel`, {
          method: "POST",
          headers,
        })
      ).status,
    ).toBe(200);
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
    await close();
  }
});

test("a ready child keeps its context for follow-ups until it is dismissed", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("async-agents");
  const { url, close } = await startTestServer();
  const headers = userHeaders(undefined, {
    "Content-Type": "application/json",
  });
  const post = (path: string, body = {}) =>
    fetch(url + path, { method: "POST", headers, body: JSON.stringify(body) });
  const created = await post("/api/sessions", { model });
  const { id } = (await created.json()) as { id: string };
  const results = (mainId: string) =>
    agentRuntime.store
      .inbox(mainId)
      .filter((m) => m.kind === "result" && m.deliveredAt !== null).length;
  try {
    await post(`/api/sessions/${id}/messages`, { content: "Research", model });
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

    expect(
      (await post(`/api/sessions/${id}/agents/${child.id}/cancel`)).status,
    ).toBe(200);
    const dismissed = agentRuntime.store.get(child.id)!;
    expect(dismissed.status).toBe("completed");
    expect(dismissed.endedAt).toBeNumber();
    expect(dismissed.activity).toBe(followedUp.activity);
    expect(() =>
      agentRuntime.enqueue(dismissed, main.id, "message", "Again"),
    ).toThrow("no longer accepting messages");
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
    await close();
  }
});

test("a blocking spawn returns the child's result to the same reply", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("blocking-agent");
  const { url, close } = await startTestServer();
  const headers = userHeaders(undefined, {
    "Content-Type": "application/json",
  });
  const post = (path: string, body = {}) =>
    fetch(url + path, { method: "POST", headers, body: JSON.stringify(body) });
  const created = await post("/api/sessions", { model });
  const { id } = (await created.json()) as { id: string };
  try {
    await post(`/api/sessions/${id}/messages`, { content: "Research", model });
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
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
    await close();
  }
});

test("Stop holds input already queued until Deliver, and invalid rewind is rejected", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("delayed-stream");
  const { url, close } = await startTestServer();
  const headers = userHeaders(undefined, {
    "Content-Type": "application/json",
  });
  const post = (path: string, body = {}) =>
    fetch(url + path, { method: "POST", headers, body: JSON.stringify(body) });
  const created = await post("/api/sessions", { model });
  const { id } = (await created.json()) as { id: string };
  try {
    await post(`/api/sessions/${id}/messages`, { content: "First", model });
    await until(() =>
      Boolean(agentRuntime.snapshot(TEST_USER_ID, id).activation?.content),
    );
    await post(`/api/sessions/${id}/messages`, { content: "Queued", model });
    await post(`/api/sessions/${id}/stop`);
    expect(agentRuntime.snapshot(TEST_USER_ID, id).held).toBe(true);
    expect(agentRuntime.snapshot(TEST_USER_ID, id).activation).toBeNull();
    expect(
      agentRuntime.snapshot(TEST_USER_ID, id).queued.map((m) => m.content),
    ).toEqual(["Queued"]);
    expect(
      (await post(`/api/sessions/${id}/rewind`, { position: 99 })).status,
    ).toBe(400);
    const queuedId = agentRuntime.snapshot(TEST_USER_ID, id).queued[0]!.id;
    expect(
      (
        await fetch(`${url}/api/sessions/${id}/messages/${queuedId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ content: "Edited" }),
        })
      ).status,
    ).toBe(200);
    await post(`/api/sessions/${id}/deliver`);
    await until(
      () =>
        !agentRuntime.snapshot(TEST_USER_ID, id).activation &&
        agentRuntime.snapshot(TEST_USER_ID, id).queued.length === 0,
    );
    expect(
      getMessagesForSession(TEST_USER_ID, id)
        .filter((m) => m.role === "user")
        .map((m) => m.content),
    ).toEqual(["First", "Edited"]);
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
    await close();
  }
});

test("deleting a chat settles its main and child activations before deleting durable state", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("async-agents");
  const { url, close } = await startTestServer();
  const headers = userHeaders(undefined, {
    "Content-Type": "application/json",
  });
  const created = await fetch(`${url}/api/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model }),
  });
  const { id } = (await created.json()) as { id: string };
  try {
    await fetch(`${url}/api/sessions/${id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "Research", model }),
    });
    await until(() =>
      agentRuntime.store
        .list(TEST_USER_ID, id)
        .some((a) => a.kind === "general" && a.status === "running"),
    );
    const response = await fetch(`${url}/api/sessions/${id}`, {
      method: "DELETE",
      headers,
    });
    expect(response.ok).toBe(true);
    expect(agentRuntime.store.list(TEST_USER_ID, id)).toEqual([]);
    expect((await fetch(`${url}/api/sessions/${id}`, { headers })).status).toBe(
      404,
    );
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
    await close();
  }
});
