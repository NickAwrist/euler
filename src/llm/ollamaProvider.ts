import type { ChatResponse, Message, ToolCall } from "ollama";
import { getOllamaClient } from "../ollamaClient";
import type {
  LlmChatRequest,
  LlmChatStream,
  LlmMessage,
  LlmStreamChunk,
  LlmToolCall,
} from "./types";

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function nsToMs(value: number): number {
  return value / 1_000_000;
}

function metricsFromOllamaChunk(chunk: ChatResponse) {
  const outputTokens = finiteNumber(chunk.eval_count);
  const outputDurationNs = finiteNumber(chunk.eval_duration);
  const promptTokens = finiteNumber(chunk.prompt_eval_count);
  const promptDurationNs = finiteNumber(chunk.prompt_eval_duration);
  const totalDurationNs = finiteNumber(chunk.total_duration);
  const loadDurationNs = finiteNumber(chunk.load_duration);
  const metrics: NonNullable<LlmStreamChunk["metrics"]> = { cost: 0 };

  if (outputTokens !== undefined) metrics.outputTokens = outputTokens;
  if (outputDurationNs !== undefined) {
    metrics.outputDurationMs = nsToMs(outputDurationNs);
  }
  if (promptTokens !== undefined) metrics.promptTokens = promptTokens;
  if (promptDurationNs !== undefined) {
    metrics.promptDurationMs = nsToMs(promptDurationNs);
  }
  if (totalDurationNs !== undefined) {
    metrics.totalDurationMs = nsToMs(totalDurationNs);
  }
  if (loadDurationNs !== undefined) {
    metrics.loadDurationMs = nsToMs(loadDurationNs);
  }
  if (
    outputTokens !== undefined &&
    outputDurationNs !== undefined &&
    outputDurationNs > 0
  ) {
    metrics.tokensPerSecond = outputTokens / (outputDurationNs / 1_000_000_000);
  }

  return metrics;
}

function toOllamaMessages(messages: LlmMessage[]): Message[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.images?.length
      ? { images: message.images.map((image) => image.data) }
      : {}),
    ...(message.tool_calls
      ? { tool_calls: message.tool_calls as ToolCall[] }
      : {}),
  }));
}

function toLlmToolCalls(toolCalls: ToolCall[] | undefined): LlmToolCall[] {
  return (toolCalls ?? []).map((toolCall) => ({
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    },
  }));
}

export async function streamOllamaChat(
  request: LlmChatRequest,
): Promise<LlmChatStream> {
  const thinkOpt =
    /gemma/i.test(request.model) || /qwen3/i.test(request.model)
      ? ({ think: true as const } satisfies { think: true })
      : {};
  const stream = await getOllamaClient().chat({
    model: request.model,
    messages: toOllamaMessages(request.messages),
    tools: request.tools,
    stream: true,
    ...thinkOpt,
  });

  return {
    abort: () => stream.abort(),
    async *[Symbol.asyncIterator]() {
      for await (const chunk of stream) {
        yield {
          contentDelta: chunk.message.content ?? "",
          thinkingDelta: chunk.message.thinking ?? "",
          ...(chunk.message.tool_calls?.length
            ? { toolCalls: toLlmToolCalls(chunk.message.tool_calls) }
            : {}),
          ...(chunk.done ? { metrics: metricsFromOllamaChunk(chunk) } : {}),
          done: chunk.done,
        };
      }
    },
  };
}
