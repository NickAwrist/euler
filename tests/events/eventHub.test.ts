import { expect, test } from "bun:test";
import { EventHub } from "../../src/events/eventHub";
import type { AgentEvent } from "../../src/events/types";
import type { Event } from "../../src/gen/euler/v1/events_pb";

const queued = (sessionId: string, agentId: string): AgentEvent => ({
  type: "inbox_queued",
  sessionId,
  agentId,
  messages: [],
});

/** Reads `count` events from a subscription, then leaves it open. */
async function take(stream: AsyncGenerator<Event>, count: number) {
  const events: Event[] = [];
  while (events.length < count) {
    const next = await stream.next();
    if (next.done) break;
    events.push(next.value);
  }
  return events;
}

test("replay is ordered, owner scoped, and resyncs an expired cursor", async () => {
  const hub = new EventHub();
  const cursor = hub.sequence("a");
  hub.publish("a", queued("chat-a", "main-a"));
  hub.publish("b", queued("chat-b", "main-b"));
  hub.publish("a", queued("chat-a", "child-a"));
  const controller = new AbortController();
  const events = await take(hub.subscribe("a", cursor, controller.signal), 2);
  expect(events.map((event) => event.sessionId)).toEqual(["chat-a", "chat-a"]);
  expect(events.map((event) => Number(event.sequence))).toEqual([
    cursor + 1,
    cursor + 2,
  ]);
  expect(events[0]?.payload.case).toBe("inboxQueued");
  controller.abort();
  for (let i = 0; i < 2001; i++) hub.publish("a", queued("chat-a", "main-a"));
  const stale = new AbortController();
  const [resync] = await take(hub.subscribe("a", cursor, stale.signal), 1);
  expect(resync?.payload.case).toBe("resync");
  expect(Number(resync?.sequence)).toBe(hub.sequence("a"));
  stale.abort();
});

test("a first connection starts with a resync at the current sequence", async () => {
  const hub = new EventHub();
  hub.publish("a", queued("chat-a", "main-a"));
  const controller = new AbortController();
  const [first] = await take(hub.subscribe("a", 0, controller.signal), 1);
  expect(first?.payload.case).toBe("resync");
  expect(Number(first?.sequence)).toBe(hub.sequence("a"));
  controller.abort();
});

test("live events follow replay, and idle streams send keepalives", async () => {
  const hub = new EventHub(20);
  const controller = new AbortController();
  const stream = hub.subscribe("a", hub.sequence("a"), controller.signal);
  const pending = take(stream, 2);
  hub.publish("a", queued("chat-a", "main-a"));
  const [live, keepalive] = await pending;
  expect(live?.payload.case).toBe("inboxQueued");
  expect(keepalive?.payload.case).toBe("keepalive");
  expect(keepalive?.sequence).toBe(0n);
  controller.abort();
});

test("aborting a stream unsubscribes it, even while it waits", async () => {
  const hub = new EventHub(60_000);
  const controller = new AbortController();
  const stream = hub.subscribe("a", hub.sequence("a"), controller.signal);
  const next = stream.next();
  await Bun.sleep(0);
  expect(hub.hasSubscribers("a")).toBe(true);
  controller.abort();
  expect(hub.hasSubscribers("a")).toBe(false);
  expect((await next).done).toBe(true);
  expect(() => hub.publish("a", queued("chat-a", "main-a"))).not.toThrow();
});

test("a slow subscriber is dropped once its pending events overflow", async () => {
  const hub = new EventHub(60_000);
  const controller = new AbortController();
  const stream = hub.subscribe("a", hub.sequence("a"), controller.signal);
  const first = stream.next();
  hub.publish("a", queued("chat-a", "main-a"));
  expect((await first).value?.payload.case).toBe("inboxQueued");
  // The client stops reading while events keep arriving.
  const large = queued("chat-a", "x".repeat(300 * 1024));
  for (let i = 0; i < 4; i++) hub.publish("a", large);
  // The stream ends instead of delivering, so the client reconnects with its sequence.
  expect((await stream.next()).done).toBe(true);
  expect(hub.hasSubscribers("a")).toBe(false);
});

test("replay is bounded by size so large step events cannot grow it without limit", async () => {
  const hub = new EventHub();
  const cursor = hub.sequence("a");
  const large = queued("chat-a", "x".repeat(1024 * 1024));
  for (let i = 0; i < 5; i++) hub.publish("a", large);
  const stale = new AbortController();
  const [resync] = await take(hub.subscribe("a", cursor, stale.signal), 1);
  expect(resync?.payload.case).toBe("resync");
  stale.abort();
  const recent = new AbortController();
  const events = await take(hub.subscribe("a", cursor + 3, recent.signal), 2);
  expect(events.map((event) => Number(event.sequence))).toEqual([
    cursor + 4,
    cursor + 5,
  ]);
  recent.abort();
});

test("an event that does not fit the contract becomes a resync for its chat", async () => {
  const hub = new EventHub();
  const cursor = hub.sequence("a");
  hub.publish("a", {
    type: "step",
    sessionId: "chat-a",
    agentId: "main-a",
    activationId: "activation",
    position: 0,
    step: { kind: "unknown", status: "done", startedAt: "" },
  });
  const controller = new AbortController();
  const [event] = await take(hub.subscribe("a", cursor, controller.signal), 1);
  expect(event?.payload.case).toBe("resync");
  expect(event?.sessionId).toBe("chat-a");
  controller.abort();
});

test("observers see every published event with its owner", () => {
  const hub = new EventHub();
  const seen: [string, AgentEvent["type"]][] = [];
  hub.observe((owner, event) => seen.push([owner, event.type]));
  hub.publish("a", queued("chat", "main"));
  hub.publish("b", queued("other", "main"));
  expect(seen).toEqual([
    ["a", "inbox_queued"],
    ["b", "inbox_queued"],
  ]);
});
