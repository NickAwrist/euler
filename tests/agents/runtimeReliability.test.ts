import "../setup";
import { expect, spyOn, test } from "bun:test";
import { AgentRuntime } from "../../src/agents/runtime/AgentRuntime";
import type { OutputAttachment } from "../../src/attachments/types";
import { setBraveSearchApiKey, setOpenRouterApiKey } from "../../src/db";
import { AgentStore } from "../../src/db/agents";
import { createSessionRow, getSessionById } from "../../src/db/sessions";
import { eventHub } from "../../src/events/eventHub";
import { GenerateImageTool } from "../../src/tools/generate_image";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import {
  getOpenRouterRequests,
  setOpenRouterScenario,
} from "../helpers/mockOpenRouter";

const owner = "11111111-1111-4111-8111-111111111111";
const model = "openrouter:openai/gpt-5.6-terra";
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await Bun.sleep(5);
  }
}
async function session(runtime: AgentRuntime) {
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), model);
  await workspaceService.provisionRetained(owner, id);
  setOpenRouterApiKey("test");
  const main = runtime.main(owner, id);
  main.model = model;
  runtime.store.save(main);
  return main;
}

for (const resume of ["deliver", "message"] as const) {
  test(`setup failure holds input without retrying until ${resume}`, async () => {
    const runtime = new AgentRuntime();
    const main = await session(runtime);
    const fault = spyOn(workspaceService, "resolveSession").mockRejectedValue(
      new Error("Workspace unavailable"),
    );
    try {
      runtime.send(main, { content: "Original", attachmentIds: [] });
      await until(
        () =>
          runtime.snapshot(owner, main.sessionId).held &&
          !runtime.busy(owner, main.sessionId),
      );
      await Bun.sleep(25);
      expect(fault).toHaveBeenCalledTimes(1);
      expect(getOpenRouterRequests()).toHaveLength(0);
      expect(runtime.store.undelivered(main.id)).toMatchObject([
        { content: "Original", held: true },
      ]);
      expect(runtime.snapshot(owner, main.sessionId).history).toHaveLength(1);
      fault.mockRestore();
      if (resume === "deliver") runtime.deliver(main);
      else runtime.send(main, { content: "Try again", attachmentIds: [] });
      await until(
        () =>
          getOpenRouterRequests().length === 1 &&
          !runtime.busy(owner, main.sessionId),
      );
      expect(runtime.store.undelivered(main.id)).toHaveLength(0);
      expect(
        runtime
          .snapshot(owner, main.sessionId)
          .history.filter((m) => m.content === "Original"),
      ).toHaveLength(1);
    } finally {
      fault.mockRestore();
      await runtime.deleteSession(owner, main.sessionId);
    }
  });
}

test("a child error reports failure and leaves the child ready with its context", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  const worker = {
    ...main,
    id: crypto.randomUUID(),
    parentId: main.id,
    kind: "general" as const,
    history: [],
    checkpoints: {},
  };
  runtime.store.save(worker);
  setOpenRouterScenario("rate-limit");
  try {
    runtime.enqueue(worker, main.id, "message", "First assignment");
    await until(() =>
      runtime.store.inbox(main.id).some((m) => m.kind === "failure"),
    );
    const errored = runtime.store.get(worker.id)!;
    expect(errored.status).toBe("idle");
    expect(errored.endedAt).toBeNull();
    expect(errored.interruption).toBe(errored.activity);
    setOpenRouterScenario("streaming");
    runtime.enqueue(worker, main.id, "message", "Try again");
    await until(() =>
      runtime.store.inbox(main.id).some((m) => m.kind === "result"),
    );
    const recovered = runtime.store.get(worker.id)!;
    expect(recovered.interruption).toBeUndefined();
    expect(
      recovered.history.some((m) => m.content.includes("First assignment")),
    ).toBe(true);
  } finally {
    await runtime.deleteSession(owner, main.sessionId);
  }
});

test("model selection and message acceptance commit together and survive reload", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  const fault = spyOn(runtime.store, "enqueue").mockImplementation(() => {
    throw new Error("Inbox unavailable");
  });
  try {
    expect(() =>
      runtime.send(main, {
        content: "Rejected",
        model: "llama3:latest",
        attachmentIds: [],
      }),
    ).toThrow("Inbox unavailable");
    expect(getSessionById(owner, main.sessionId)?.model).toBe(model);
    expect(new AgentStore().get(main.id)?.model).toBe(model);
    fault.mockRestore();
    runtime.send(main, {
      content: "Accepted",
      model: "llama3:latest",
      attachmentIds: [],
    });
    await until(
      () =>
        runtime.snapshot(owner, main.sessionId).history.length === 2 &&
        !runtime.busy(owner, main.sessionId),
    );
    expect(getSessionById(owner, main.sessionId)?.model).toBe("llama3:latest");
    expect(new AgentStore().get(main.id)?.model).toBe("llama3:latest");
  } finally {
    fault.mockRestore();
    await runtime.deleteSession(owner, main.sessionId);
  }
});

test("child outputs survive waiting and result delivery without depending on reply text", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  const child = {
    ...main,
    id: crypto.randomUUID(),
    parentId: main.id,
    kind: "general" as const,
  };
  runtime.store.save(child);
  setBraveSearchApiKey("brave-child-outputs-test");
  setOpenRouterScenario("child-outputs");
  const image = {
    kind: "generated_image",
    url: "/api/comfyui/view/child.png",
  } as const;
  const generate = spyOn(
    GenerateImageTool.prototype,
    "execute",
  ).mockResolvedValue({ text: "Image created", attachments: [image] });
  try {
    runtime.enqueue(child, main.id, "task", "Generate a report");
    await until(() => runtime.store.get(child.id)?.status === "waiting");
    const outputs = runtime.store.get(child.id)!.pendingOutputs;
    expect(outputs).toEqual([
      image,
      {
        kind: "web_source",
        title: "Mocked Search Result 1",
        url: "https://example.com/result1",
      },
      expect.objectContaining({
        kind: "file",
        path: "report.txt",
      }),
    ]);
    expect(new AgentStore().get(child.id)?.pendingOutputs).toEqual(outputs);
    runtime.enqueue(child, main.id, "message", "Finish");
    const report = () =>
      runtime.store.inbox(main.id).find((m) => m.kind === "result");
    await until(
      () =>
        report()?.deliveredAt != null && !runtime.busy(owner, main.sessionId),
    );
    expect(report()?.attachments).toEqual(outputs);
    expect(report()?.content).not.toContain("child.png");
    const { history } = runtime.snapshot(owner, main.sessionId);
    const replies = history.length;
    expect(history.at(-1)?.attachments).toEqual(outputs);
    runtime.send(runtime.store.get(main.id)!, {
      content: "Thanks",
      attachmentIds: [],
    });
    await until(
      () =>
        runtime.snapshot(owner, main.sessionId).history.length ===
          replies + 2 && !runtime.busy(owner, main.sessionId),
    );
    expect(
      runtime.snapshot(owner, main.sessionId).history.at(-1)?.attachments ?? [],
    ).toEqual([]);
  } finally {
    generate.mockRestore();
    await runtime.deleteSession(owner, main.sessionId);
  }
});

test("restart preserves outputs already delivered to an interrupted parent exactly once", async () => {
  const first = new AgentRuntime();
  const main = await session(first);
  const outputs: OutputAttachment[] = [
    { kind: "generated_image", url: "/api/comfyui/view/child.png" },
  ];
  main.status = "running";
  main.pendingOutputs = outputs;
  first.store.save(main);
  first.store.saveReply(main, "Partial reply");
  const recovered = new AgentRuntime();
  try {
    recovered.recover();
    recovered.recover();
    expect(recovered.snapshot(owner, main.sessionId).history).toHaveLength(1);
    expect(
      recovered.snapshot(owner, main.sessionId).history[0]?.attachments,
    ).toEqual(outputs);
    expect(recovered.store.get(main.id)?.pendingOutputs).toEqual([]);
  } finally {
    await recovered.deleteSession(owner, main.sessionId);
  }
});

test("a failure while recording an activation does not stop the runtime", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  setOpenRouterScenario("streaming");
  const publish = eventHub.publish.bind(eventHub);
  const fault = spyOn(eventHub, "publish").mockImplementation(
    (target, event) => {
      if (event.type === "activation_ended") throw new Error("disk full");
      publish(target, event);
    },
  );
  process.env.LOG_LEVEL = "error";
  const errors = spyOn(console, "error").mockImplementation(() => {});
  const logged = (event: string) =>
    errors.mock.calls.some(
      ([line]) =>
        typeof line === "string" &&
        (JSON.parse(line) as { event?: string }).event === event,
    );
  const settled = (length: number) =>
    runtime.snapshot(owner, main.sessionId).history.length === length &&
    !runtime.busy(owner, main.sessionId);
  try {
    runtime.send(main, { content: "Hello", attachmentIds: [] });
    await until(() => settled(2) && logged("activation.unrecorded"));
    // The end event was lost, so clients are told to reload the chat.
    expect(fault).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ type: "resync", sessionId: main.sessionId }),
    );
    fault.mockRestore();
    runtime.send(runtime.store.get(main.id)!, {
      content: "Again",
      attachmentIds: [],
    });
    await until(() => settled(4));
  } finally {
    fault.mockRestore();
    errors.mockRestore();
    process.env.LOG_LEVEL = "silent";
    await runtime.deleteSession(owner, main.sessionId);
  }
});

test("a message sent mid-reply switches the main agent's model from the next call", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  setOpenRouterScenario("delayed-stream");
  const requests = getOpenRouterRequests();
  const start = requests.length;
  try {
    runtime.send(main, { content: "First", attachmentIds: [] });
    await until(() => requests.length > start);
    const { queued } = runtime.send(runtime.store.get(main.id)!, {
      content: "Second",
      model: "openrouter:anthropic/claude-test",
      attachmentIds: [],
    });
    expect(queued).toBe(true);
    await until(
      () =>
        runtime.snapshot(owner, main.sessionId).history.length === 4 &&
        !runtime.busy(owner, main.sessionId),
    );
    expect(requests.slice(start).map((r) => r.body.model)).toEqual([
      "openai/gpt-5.6-terra",
      "anthropic/claude-test",
    ]);
  } finally {
    await runtime.deleteSession(owner, main.sessionId);
  }
});

test("a chat stays locked until the caller has deleted it", async () => {
  const runtime = new AgentRuntime();
  const main = await session(runtime);
  const locked = await runtime.deleteSession(
    owner,
    main.sessionId,
    async () => {
      // Stop, Deliver, and queued edits would otherwise recreate the main agent.
      expect(() => runtime.main(owner, main.sessionId)).toThrow(
        "being deleted",
      );
      return runtime.isChanging(main.sessionId);
    },
  );
  expect(locked).toBe(true);
  expect(runtime.store.list(owner, main.sessionId)).toEqual([]);
  expect(runtime.isChanging(main.sessionId)).toBe(false);
});
