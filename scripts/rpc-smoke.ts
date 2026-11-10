#!/usr/bin/env bun
/**
 * Checks a running server end to end: a unary RPC, then the event stream over
 * HTTP/1.1 until a keepalive arrives. With --chat, it also sends a message to
 * a new ephemeral chat and reports how its reply streamed.
 *
 *   bun scripts/rpc-smoke.ts <base URL> <user ID> [--chat <model>]
 */
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { AgentService } from "../src/gen/euler/v1/agent_pb";
import { EventService } from "../src/gen/euler/v1/events_pb";
import { SessionService } from "../src/gen/euler/v1/sessions_pb";

const [baseUrl, userId] = process.argv.slice(2);
const chatIndex = process.argv.indexOf("--chat");
const model = chatIndex === -1 ? undefined : process.argv[chatIndex + 1];
if (!baseUrl || !userId) {
  console.error(
    "Usage: bun scripts/rpc-smoke.ts <base URL> <user ID> [--chat <model>]",
  );
  process.exit(2);
}

const transport = createConnectTransport({
  baseUrl: new URL("/api/rpc", baseUrl).toString(),
  httpVersion: "1.1",
  useBinaryFormat: true,
  interceptors: [
    (next) => (request) => {
      request.header.set("x-euler-user-id", userId);
      return next(request);
    },
  ],
});
const sessions = createClient(SessionService, transport);
const agents = createClient(AgentService, transport);
const events = createClient(EventService, transport);

const started = performance.now();
const elapsed = () => `${Math.round(performance.now() - started)}ms`;
const { sessions: list } = await sessions.listSessions({});
console.log(`ListSessions: ${list.length} chats (${elapsed()})`);

const controller = new AbortController();
let chatId: string | undefined;
let deltas = 0;
let firstDelta: string | undefined;
let lastFrame = performance.now();
let longestGap = 0;
const deadline = setTimeout(() => controller.abort(), model ? 180_000 : 20_000);
try {
  for await (const { event } of events.subscribe(
    { afterSequence: 0n },
    { signal: controller.signal },
  )) {
    const now = performance.now();
    longestGap = Math.max(longestGap, now - lastFrame);
    lastFrame = now;
    const payload = event?.payload;
    if (!payload) continue;
    if (payload.case === "resync" && model && !chatId) {
      console.log(
        `Subscribe: first frame resync at ${event?.sequence} (${elapsed()})`,
      );
      const created = await sessions.createSession({ model, ephemeral: true });
      chatId = created.id;
      await agents.sendMessage({
        sessionId: chatId,
        content: "Count from one to twenty, one number per line.",
        settings: { model },
      });
      console.log(`SendMessage to ${chatId} (${elapsed()})`);
      continue;
    }
    if (payload.case === "keepalive") {
      console.log(`Keepalive (${elapsed()})`);
      if (!model) break;
      continue;
    }
    if (event?.sessionId !== chatId) continue;
    if (payload.case === "delta") {
      deltas++;
      firstDelta ??= elapsed();
    }
    if (payload.case === "activationEnded") {
      console.log(
        `Reply streamed ${deltas} deltas, first at ${firstDelta}, ended ${elapsed()}`,
      );
      break;
    }
  }
} finally {
  clearTimeout(deadline);
  controller.abort();
  if (chatId) await sessions.deleteSession({ id: chatId });
}
console.log(`Longest gap between frames: ${Math.round(longestGap)}ms`);
