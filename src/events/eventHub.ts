import { toBinary } from "@bufbuild/protobuf";
import { type Event, EventSchema } from "../gen/euler/v1/events_pb";
import { logEvent } from "../observability/logger";
import { event, keepaliveEvent, resyncEvent } from "../rpc/wire";
import type { AgentEvent } from "./types";

/** Events kept per user so a reconnecting client can replay what it missed. */
const MAX_REPLAY_EVENTS = 2000;
/** Step events carry whole traces, so replay is also bounded by size. */
const MAX_REPLAY_BYTES = 4 * 1024 * 1024;
/** Events a slow subscriber may have pending before it is dropped. */
const MAX_PENDING_BYTES = 1024 * 1024;
/**
 * How long a stream stays silent before a keepalive. Bun's node:http keeps an
 * idle response open for minutes; proxies are the tighter limit.
 */
export const KEEPALIVE_MS = 5000;

type Stored = { event: Event; bytes: number };
type Subscriber = {
  pending: Stored[];
  bytes: number;
  /** Set once the subscriber fell too far behind and must reconnect. */
  dropped: boolean;
  wake?: () => void;
};
type UserState = {
  sequence: number;
  events: Stored[];
  bytes: number;
  subscribers: Set<Subscriber>;
};

const stored = (value: Event): Stored => ({
  event: value,
  bytes: toBinary(EventSchema, value).length,
});

type Observer = (owner: string, event: AgentEvent) => void;

export class EventHub {
  private users = new Map<string, UserState>();
  private observers: Observer[] = [];
  constructor(private readonly keepaliveMs = KEEPALIVE_MS) {}
  private user(owner: string) {
    let state = this.users.get(owner);
    if (!state) {
      state = {
        sequence: Date.now(),
        events: [],
        bytes: 0,
        subscribers: new Set(),
      };
      this.users.set(owner, state);
    }
    return state;
  }
  sequence(owner: string) {
    return this.user(owner).sequence;
  }
  /** Whether a client holds a stream open for the owner, as the foreground app does. */
  hasSubscribers(owner: string) {
    return (this.users.get(owner)?.subscribers.size ?? 0) > 0;
  }
  /** Calls `observer` with each event published from now on, as push does. */
  observe(observer: Observer) {
    this.observers.push(observer);
  }
  publish(owner: string, value: AgentEvent) {
    const state = this.user(owner);
    const sequence = ++state.sequence;
    let entry: Stored;
    try {
      entry = stored(event(value, sequence));
    } catch (error) {
      // A record that does not fit the contract must not stop the runtime;
      // clients refetch the chat instead.
      logEvent(
        "error",
        "events.unencodable",
        { sessionId: value.sessionId },
        error,
      );
      entry = stored(
        event(
          { type: "resync", sessionId: value.sessionId, agentId: "" },
          sequence,
        ),
      );
    }
    state.events.push(entry);
    state.bytes += entry.bytes;
    while (
      state.events.length > MAX_REPLAY_EVENTS ||
      state.bytes > MAX_REPLAY_BYTES
    )
      state.bytes -= state.events.shift()?.bytes ?? 0;
    for (const subscriber of state.subscribers) {
      if (subscriber.dropped) continue;
      subscriber.pending.push(entry);
      subscriber.bytes += entry.bytes;
      // A client far behind is dropped and reconnects with its sequence.
      if (subscriber.bytes > MAX_PENDING_BYTES) subscriber.dropped = true;
      subscriber.wake?.();
    }
    for (const observer of this.observers) observer(owner, value);
  }
  /**
   * The owner's events after `afterSequence`: the buffered ones, or Resync when
   * the buffer has moved past it, then live ones with keepalives while idle.
   * Ends when `signal` aborts or the subscriber falls too far behind.
   */
  async *subscribe(
    owner: string,
    afterSequence: number,
    signal: AbortSignal,
  ): AsyncGenerator<Event> {
    const state = this.user(owner);
    const subscriber: Subscriber = { pending: [], bytes: 0, dropped: false };
    const oldest = Number(
      state.events[0]?.event.sequence ?? state.sequence + 1,
    );
    if (
      afterSequence &&
      afterSequence >= oldest - 1 &&
      afterSequence <= state.sequence
    )
      subscriber.pending.push(
        ...state.events.filter(
          (entry) => Number(entry.event.sequence) > afterSequence,
        ),
      );
    else subscriber.pending.push(stored(resyncEvent(state.sequence)));
    state.subscribers.add(subscriber);
    // A generator paused at `yield` resumes only when pulled, so a departed
    // client is removed on abort directly.
    const onAbort = () => {
      state.subscribers.delete(subscriber);
      subscriber.wake?.();
    };
    signal.addEventListener("abort", onAbort);
    try {
      while (!signal.aborted && !subscriber.dropped) {
        const next = subscriber.pending.shift();
        if (next) {
          subscriber.bytes = Math.max(0, subscriber.bytes - next.bytes);
          yield next.event;
          continue;
        }
        const idle = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(true), this.keepaliveMs);
          subscriber.wake = () => {
            clearTimeout(timer);
            resolve(false);
          };
        });
        subscriber.wake = undefined;
        if (idle && !signal.aborted) yield keepaliveEvent();
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      state.subscribers.delete(subscriber);
    }
  }
}
export const eventHub = new EventHub();
