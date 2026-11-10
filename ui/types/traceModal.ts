import type { Step } from "./run";

/** Steps modal: persisted steps, live SSE, or closed. */
export type TraceModalSelection = Step[] | "live" | null;

/** Opening the trace modal with saved steps or the live stream. */
export type TraceModalOpenPayload = Step[] | "live";
