import "../setup";
import { expect, spyOn, test } from "bun:test";
import { AgentRuntime } from "../../src/agents/runtime/AgentRuntime";
import type { OutputAttachment } from "../../src/attachments/types";
import { setOpenRouterApiKey, setSearXNGHost } from "../../src/db";
import { AgentStore } from "../../src/db/agents";
import { createSessionRow, getSessionById } from "../../src/db/sessions";
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
async function session(runtime: AgentRuntime, temporary = false) {
  const id = temporary
    ? (await workspaceService.createTemporary(owner)).id
    : crypto.randomUUID();
  if (!temporary) {
    createSessionRow(owner, id, Date.now(), model);
    await workspaceService.provisionRetained(owner, id);
  }
  setOpenRouterApiKey("test");
  const main = runtime.main(owner, id, temporary);
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

for (const temporary of [false, true]) {
  test(`${temporary ? "temporary" : "retained"} child outputs survive waiting and result delivery without depending on reply text`, async () => {
    let runtime = new AgentRuntime();
    const main = await session(runtime, temporary);
    main.held = true;
    runtime.store.save(main);
    const child = {
      ...main,
      id: crypto.randomUUID(),
      parentId: main.id,
      kind: "general" as const,
      held: false,
    };
    runtime.store.save(child, temporary);
    setSearXNGHost("http://searxng.test");
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
          temporary,
        }),
      ]);
      if (!temporary)
        expect(new AgentStore().get(child.id)?.pendingOutputs).toEqual(outputs);
      runtime.enqueue(child, main.id, "message", "Finish");
      await until(() =>
        runtime.store.inbox(main.id).some((m) => m.kind === "result"),
      );
      const report = runtime.store
        .inbox(main.id)
        .find((m) => m.kind === "result")!;
      expect(report.attachments).toEqual(outputs);
      expect(report.content).not.toContain("child.png");
      if (!temporary) {
        runtime = new AgentRuntime();
        runtime.recover();
        expect(
          runtime.store.inbox(main.id).find((m) => m.kind === "result")
            ?.attachments,
        ).toEqual(outputs);
      }
      runtime.deliver(runtime.store.get(main.id)!);
      await until(
        () =>
          runtime.snapshot(owner, main.sessionId).history.length === 1 &&
          !runtime.busy(owner, main.sessionId),
      );
      expect(
        runtime.snapshot(owner, main.sessionId).history[0]?.attachments,
      ).toEqual(outputs);
      runtime.send(runtime.store.get(main.id)!, {
        content: "Thanks",
        attachmentIds: [],
      });
      await until(
        () =>
          runtime.snapshot(owner, main.sessionId).history.length === 3 &&
          !runtime.busy(owner, main.sessionId),
      );
      expect(
        runtime.snapshot(owner, main.sessionId).history.at(-1)?.attachments ??
          [],
      ).toEqual([]);
    } finally {
      generate.mockRestore();
      await runtime.deleteSession(owner, main.sessionId);
    }
  });
}

test("restart preserves outputs already delivered to an interrupted parent exactly once", async () => {
  const first = new AgentRuntime();
  const main = await session(first);
  const outputs: OutputAttachment[] = [
    { kind: "generated_image", url: "/api/comfyui/view/child.png" },
  ];
  main.status = "running";
  main.partial = { role: "assistant", content: "Partial reply", steps: [] };
  main.pendingOutputs = outputs;
  first.store.save(main);
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
