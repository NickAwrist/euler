import "../env-setup";
import { expect, test } from "bun:test";
import { AgentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { RuntimeTransaction } from "../../src/agents/runtime/RuntimeTransaction";
import { AgentStore } from "../../src/db/agents";
import { createSessionRow } from "../../src/db/sessions";

const owner = "11111111-1111-4111-8111-111111111111";

test("rollback restores cached identities and inbox state without publishing effects", () => {
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), "test");
  const runtime = new AgentRuntime();
  const agent = runtime.main(owner, id);
  const tx = new RuntimeTransaction();
  const effects: string[] = [];
  const restore = runtime.store.checkpoint(id);
  expect(() =>
    tx.run(() => {
      agent.activity = "uncommitted";
      runtime.store.save(agent);
      runtime.store.enqueue({
        agentId: agent.id,
        sender: "user",
        kind: "user",
        content: "uncommitted",
        wakes: true,
        attachmentIds: [],
      });
      tx.defer(() => effects.push("published"));
      throw new Error("rollback");
    }, restore),
  ).toThrow("rollback");
  expect(runtime.store.get(agent.id)).toBe(agent);
  expect(agent.activity).toBe("");
  expect(new AgentStore().get(agent.id)?.activity).toBe("");
  expect(runtime.store.inbox(agent.id)).toEqual([]);
  expect(effects).toEqual([]);
});

test("failed savepoint drops only its own effects and commit preserves ordering", () => {
  const tx = new RuntimeTransaction();
  const effects: number[] = [];
  tx.run(
    () => {
      tx.defer(() => effects.push(1));
      expect(() =>
        tx.run(
          () => {
            tx.defer(() => effects.push(2));
            throw new Error("inner");
          },
          () => {},
        ),
      ).toThrow("inner");
      tx.run(
        () => tx.defer(() => effects.push(3)),
        () => {},
      );
      expect(effects).toEqual([]);
    },
    () => {},
  );
  expect(effects).toEqual([1, 3]);
});

test("idle request records are released and display reads do not refill the cache", async () => {
  const runtime = new AgentRuntime();
  for (let i = 0; i < 20; i++) {
    const id = crypto.randomUUID();
    createSessionRow(owner, id, Date.now(), "test");
    runtime.main(owner, id);
    await Promise.resolve();
    runtime.snapshot(owner, id);
  }
  expect(runtime.store.cachedSessions().size).toBe(0);
});
