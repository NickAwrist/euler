import "../env-setup";
import { expect, test } from "bun:test";
import { AgentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { AgentStore } from "../../src/db/agents";
import { getDb } from "../../src/db/connection";
import { createSessionRow } from "../../src/db/sessions";

const owner = "11111111-1111-4111-8111-111111111111";
const rowsWritten = () =>
  (getDb().query("SELECT total_changes() AS n").get() as { n: number }).n;

test("saving history writes only the messages that changed", () => {
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), "test");
  const runtime = new AgentRuntime();
  const agent = runtime.main(owner, id);
  const save = (store: AgentStore, record = agent) => {
    return (history: { role: string; content: string }[]) => {
      const before = rowsWritten();
      store.saveHistory(record, history);
      return rowsWritten() - before;
    };
  };
  const writes = save(runtime.store);
  const [a, b, c] = ["a", "b", "c"].map((content) => ({
    role: "user",
    content,
  }));
  expect(writes([a!, b!])).toBe(2);
  expect(writes([a!, b!, c!])).toBe(1);
  // Equal messages rebuilt as new objects are not written again.
  expect(writes([{ ...a! }, { ...b! }, { ...c! }])).toBe(0);
  expect(writes([a!, { role: "user", content: "changed" }, c!])).toBe(1);
  expect(writes([a!])).toBe(2);

  const store = new AgentStore();
  const loaded = store.get(agent.id)!;
  expect(loaded.history).toEqual([a!]);
  expect(save(store, loaded)([...loaded.history, c!])).toBe(1);
  expect(new AgentStore().get(agent.id)?.history).toEqual([a!, c!]);
});
