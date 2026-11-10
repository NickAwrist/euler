import type { Event } from "../../src/gen/euler/v1/events_pb";
import { eventClient } from "../lib/rpc";

/** Keeps one event stream open, resuming after the last event on reconnect. */
export async function subscribeEvents(
  signal: AbortSignal,
  receive: (event: Event) => void,
) {
  let sequence = 0n;
  while (!signal.aborted) {
    try {
      for await (const { event } of eventClient.subscribe(
        { afterSequence: sequence },
        { signal },
      )) {
        const payload = event?.payload;
        if (!event || !payload?.case || payload.case === "keepalive") continue;
        if (payload.case !== "resync" && event.sequence <= sequence) continue;
        sequence = event.sequence;
        receive(event);
      }
    } catch (error) {
      if (!signal.aborted) console.error("Event stream disconnected", error);
    }
    if (!signal.aborted)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, 1000);
        signal.addEventListener("abort", done, { once: true });
      });
  }
}
