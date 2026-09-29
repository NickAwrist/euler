import type { LlmMessage } from "../llm";

/**
 * Results for the last assistant message's tool calls that have none, which
 * providers require. Results follow their calls in order, so they are matched
 * by position: Ollama calls have no IDs.
 */
export function missingToolResults(
  history: readonly Pick<LlmMessage, "role" | "tool_calls">[],
  content: string,
): LlmMessage[] {
  const last = history.findLastIndex((m) => m.role === "assistant");
  const calls = history[last]?.tool_calls ?? [];
  const answered = history.slice(last + 1).filter((m) => m.role === "tool");
  return calls.slice(answered.length).map((call) => ({
    role: "tool",
    content,
    ...(call.id ? { tool_call_id: call.id } : {}),
  }));
}
