import type { Response } from "express";
import type { AgentEvent } from "../schemas/events";

export type Unsequenced = AgentEvent extends infer E
  ? E extends AgentEvent
    ? Omit<E, "sequence">
    : never
  : never;
/** Events kept per user so a reconnecting client can replay what it missed. */
const MAX_REPLAY_EVENTS = 2000;
/** Step events carry whole traces, so replay is also bounded by size. */
const MAX_REPLAY_BYTES = 4 * 1024 * 1024;
/** Output a slow client may buffer before it is dropped. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
type ReplayEvent = { sequence: number; chunk: string };
const toChunk = (event: AgentEvent) =>
  `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`;
export class EventHub {
  private users = new Map<
    string,
    {
      sequence: number;
      events: ReplayEvent[];
      bytes: number;
      clients: Set<Response>;
    }
  >();
  private user(owner: string) {
    let state = this.users.get(owner);
    if (!state) {
      state = {
        sequence: Date.now(),
        events: [],
        bytes: 0,
        clients: new Set(),
      };
      this.users.set(owner, state);
    }
    return state;
  }
  sequence(owner: string) {
    return this.user(owner).sequence;
  }
  publish(owner: string, event: Unsequenced) {
    const state = this.user(owner);
    const sequence = ++state.sequence;
    const chunk = toChunk({ ...event, sequence });
    state.events.push({ sequence, chunk });
    state.bytes += chunk.length;
    while (
      state.events.length > MAX_REPLAY_EVENTS ||
      state.bytes > MAX_REPLAY_BYTES
    )
      state.bytes -= state.events.shift()?.chunk.length ?? 0;
    for (const client of state.clients) this.write(client, chunk);
  }
  /** A disconnected client must never throw into the runtime publishing to it. */
  private write(client: Response, chunk: string) {
    if (client.writableEnded || client.destroyed) return;
    try {
      client.write(chunk);
      // A client far behind is dropped and reconnects with Last-Event-ID.
      if (client.writableLength > MAX_BUFFERED_BYTES) client.end();
    } catch {
      client.destroy();
    }
  }
  attach(owner: string, response: Response, lastId?: number) {
    const state = this.user(owner);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.flushHeaders();
    if (
      lastId &&
      lastId >= (state.events[0]?.sequence ?? state.sequence) - 1 &&
      lastId <= state.sequence
    ) {
      for (const event of state.events)
        if (event.sequence > lastId) this.write(response, event.chunk);
    } else
      this.write(
        response,
        toChunk({
          type: "resync",
          sessionId: "",
          agentId: "",
          sequence: state.sequence,
        }),
      );
    state.clients.add(response);
    const ping = setInterval(() => this.write(response, ": ping\n\n"), 15000);
    response.on("close", () => {
      clearInterval(ping);
      state.clients.delete(response);
    });
  }
}
export const eventHub = new EventHub();
