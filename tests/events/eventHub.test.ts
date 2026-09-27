import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import { EventHub } from "../../src/events/eventHub";
class Client extends EventEmitter {
  chunks: string[] = [];
  setHeader() {}
  flushHeaders() {}
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
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
