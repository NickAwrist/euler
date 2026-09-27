import "../setup";
import { expect, test } from "bun:test";
import { AgentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { setOpenRouterApiKey } from "../../src/db";
import { createSessionRow } from "../../src/db/sessions";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import {
  getOpenRouterRequests,
  setOpenRouterScenario,
} from "../helpers/mockOpenRouter";

const owner = "11111111-1111-4111-8111-111111111111";
const model = "openrouter:openai/gpt-5.6-terra";
async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await Bun.sleep(5);
  }
}
for (const temporary of [false, true]) {
  for (const edit of [false, true]) {
    test(`${temporary ? "temporary" : "retained"} ${edit ? "edit" : "retry"} deletes running and ended agents from discarded messages`, async () => {
      const runtime = new AgentRuntime();
      await workspaceService.initialize();
      const id = temporary
        ? (await workspaceService.createTemporary(owner)).id
        : crypto.randomUUID();
      if (!temporary) {
        createSessionRow(owner, id, Date.now(), model);
        await workspaceService.provisionRetained(owner, id);
      }
      setOpenRouterApiKey("test");
      const main = runtime.main(owner, id, temporary);
      try {
        runtime.send(main, { content: "Original", model, attachmentIds: [] });
        await until(
          () =>
            runtime.snapshot(owner, id).history.length === 2 &&
            !runtime.busy(owner, id),
        );
        const ended = {
          ...runtime.store.get(main.id)!,
          id: crypto.randomUUID(),
          parentId: main.id,
          kind: "general" as const,
          spawnPosition: 1,
          status: "completed" as const,
          history: [],
          steps: [],
        };
        runtime.store.save(ended, temporary);
        const working = {
          ...ended,
          id: crypto.randomUUID(),
          status: "idle" as const,
        };
        runtime.store.save(working, temporary);
        runtime.store.enqueue({
          agentId: main.id,
          sender: ended.id,
          kind: "result",
          content: "Discard this result",
          wakes: true,
          attachmentIds: [],
        });
        setOpenRouterScenario("delayed-stream");
        runtime.enqueue(working, main.id, "task", "Old task");
        await until(
          () =>
            runtime.store.get(working.id)?.status === "running" &&
            getOpenRouterRequests().length > 1,
        );
        setOpenRouterScenario("streaming");
        await runtime.rewind(
          owner,
          id,
          { position: 0, ...(edit ? { content: "Edited" } : {}) },
          temporary,
        );
        await until(
          () =>
            runtime.snapshot(owner, id).history.length === 2 &&
            !runtime.busy(owner, id),
        );
        expect(runtime.store.get(ended.id)).toBeUndefined();
        expect(runtime.store.get(working.id)).toBeUndefined();
        expect(runtime.store.inbox(working.id)).toEqual([]);
        expect(
          runtime.store
            .inbox(main.id)
            .some((m) => m.sender === ended.id || m.sender === working.id),
        ).toBe(false);
        expect(runtime.snapshot(owner, id).agents).toHaveLength(1);
        expect(runtime.snapshot(owner, id).history[0]?.content).toBe(
          edit ? "Edited" : "Original",
        );
        expect(
          runtime.store
            .get(main.id)
            ?.history.some((m) => m.content.includes("Discard this result")),
        ).toBe(false);
      } finally {
        await runtime.deleteSession(owner, id);
        if (temporary) await workspaceService.deleteTemporary(owner, id);
      }
    });
  }
}
