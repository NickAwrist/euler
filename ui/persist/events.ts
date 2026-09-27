import { type AgentEvent, AgentEventSchema } from "../../src/schemas/events";
import { userApiFetch } from "../lib/api";
import { readSseBlocks } from "../lib/readSseBlocks";
export async function subscribeEvents(
  signal: AbortSignal,
  receive: (event: AgentEvent) => void,
) {
  let sequence = 0;
  while (!signal.aborted) {
    try {
      const response = await userApiFetch("/api/events", {
        signal,
        headers: sequence ? { "Last-Event-ID": String(sequence) } : {},
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing event stream");
      await readSseBlocks(reader, (value) => {
        const event = AgentEventSchema.parse(value);
        if (event.type !== "resync" && event.sequence <= sequence) return;
        sequence = event.sequence;
        receive(event);
      });
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
