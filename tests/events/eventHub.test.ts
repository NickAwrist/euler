import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import { EventHub } from "../../src/events/eventHub";
class Client extends EventEmitter {
  chunks: string[] = [];
  writableEnded = false;
  destroyed = false;
  writableLength = 0;
  setHeader() {}
  flushHeaders() {}
  write(chunk: string) {
    if (this.writableEnded) throw new Error("write after end");
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit("close");
  }
  response() {
    return this as unknown as Response;
  }
}
test("event replay is ordered, owner scoped, and requests resync for an expired cursor", () => {
  const hub = new EventHub();
  const cursor = hub.sequence("a");
  hub.publish("a", {
    type: "session_activity",
    sessionId: "chat-a",
    agentId: "main-a",
  });
  hub.publish("b", {
    type: "session_activity",
    sessionId: "chat-b",
    agentId: "main-b",
  });
  hub.publish("a", {
    type: "session_activity",
    sessionId: "chat-a",
    agentId: "child-a",
  });
  const client = new Client();
  hub.attach("a", client.response(), cursor);
  expect(client.chunks).toHaveLength(2);
  expect(client.chunks.join("")).not.toContain("chat-b");
  expect(client.chunks[0]).toContain(`id: ${cursor + 1}`);
  expect(client.chunks[1]).toContain(`id: ${cursor + 2}`);
  client.end();
  for (let i = 0; i < 2001; i++)
    hub.publish("a", {
      type: "session_activity",
      sessionId: "chat-a",
      agentId: "main-a",
    });
  const stale = new Client();
  hub.attach("a", stale.response(), cursor);
  expect(stale.chunks).toHaveLength(1);
  expect(stale.chunks[0]).toContain('"type":"resync"');
  stale.end();
});

test("a slow client stays connected until its buffer overflows, then publishing skips it", () => {
  const hub = new EventHub();
  const client = new Client();
  hub.attach("a", client.response());
  // Backpressure alone keeps the client; "close" arrives after end.
  client.write = (chunk: string) => {
    if (client.writableEnded) throw new Error("write after end");
    client.writableLength += chunk.length;
    return false;
  };
  client.end = () => {
    client.writableEnded = true;
  };
  const event = {
    type: "session_activity",
    sessionId: "chat-a",
    agentId: "main-a",
  } as const;
  hub.publish("a", event);
  expect(client.writableEnded).toBe(false);
  client.writableLength = 1024 * 1024;
  hub.publish("a", event);
  expect(client.writableEnded).toBe(true);
  expect(() => hub.publish("a", event)).not.toThrow();
});

test("a throwing client cannot interrupt delivery to healthy clients", () => {
  const hub = new EventHub();
  const broken = new Client();
  const healthy = new Client();
  hub.attach("owner", broken.response());
  hub.attach("owner", healthy.response());
  broken.write = () => {
    throw new Error("socket closed");
  };
  Object.assign(broken, {
    destroy: () => {
      broken.destroyed = true;
      broken.emit("close");
    },
  });
  expect(() =>
    hub.publish("owner", { type: "resync", sessionId: "chat", agentId: "" }),
  ).not.toThrow();
  expect(broken.destroyed).toBe(true);
  expect(healthy.chunks).toHaveLength(2);
  healthy.end();
});

test("replay is bounded by size so large step events cannot grow it without limit", () => {
  const hub = new EventHub();
  const cursor = hub.sequence("a");
  const large = {
    type: "session_activity",
    sessionId: "chat-a",
    agentId: "x".repeat(1024 * 1024),
  } as const;
  for (let i = 0; i < 5; i++) hub.publish("a", large);
  const stale = new Client();
  hub.attach("a", stale.response(), cursor);
  expect(stale.chunks).toHaveLength(1);
  expect(stale.chunks[0]).toContain('"type":"resync"');
  stale.end();
  const recent = new Client();
  hub.attach("a", recent.response(), cursor + 3);
  expect(recent.chunks).toHaveLength(2);
  recent.end();
});
