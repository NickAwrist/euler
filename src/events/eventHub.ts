import type { Response } from "express";
import type { AgentEvent } from "../schemas/events";

type Unsequenced = AgentEvent extends infer E
  ? E extends AgentEvent
    ? Omit<E, "sequence">
    : never
  : never;
/** Output a slow client may buffer before it is dropped. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
export class EventHub {
  private users = new Map<
    string,
    { sequence: number; events: AgentEvent[]; clients: Set<Response> }
  >();
  private user(owner: string) {
    let state = this.users.get(owner);
    if (!state) {
      state = { sequence: Date.now(), events: [], clients: new Set() };
      this.users.set(owner, state);
    }
    return state;
  }
  sequence(owner: string) {
    return this.user(owner).sequence;
  }
  publish(owner: string, event: Unsequenced) {
    const state = this.user(owner);
    const sequenced = { ...event, sequence: ++state.sequence };
    state.events.push(sequenced);
    if (state.events.length > 2000) state.events.shift();
    for (const client of state.clients) this.send(client, sequenced);
  }
  private send(client: Response, event: AgentEvent) {
    this.write(
      client,
      `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`,
    );
  }
  /** A disconnected client must never throw into the runtime publishing to it. */
  private write(client: Response, chunk: string) {
    if (client.writableEnded || client.destroyed) return;
    client.write(chunk);
    // A client far behind is dropped and reconnects with Last-Event-ID.
    if (client.writableLength > MAX_BUFFERED_BYTES) client.end();
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
        if (event.sequence > lastId) this.send(response, event);
    } else
      this.send(response, {
        type: "resync",
        sessionId: "",
        agentId: "",
        sequence: state.sequence,
      });
    state.clients.add(response);
    const ping = setInterval(() => this.write(response, ": ping\n\n"), 15000);
    response.on("close", () => {
      clearInterval(ping);
      state.clients.delete(response);
    });
  }
}
export const eventHub = new EventHub();
