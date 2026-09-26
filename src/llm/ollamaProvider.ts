import type { ChatRequest, ChatResponse, Message, ToolCall } from "ollama";
import type { ModelReasoning } from "../modelCapabilities";
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

const GPT_OSS_EFFORTS = ["low", "medium", "high"] as const;

/**
 * Thinking controls for an Ollama model. gpt-oss always reasons and takes an
 * effort level; other thinking models can only turn reasoning on or off.
 */
export function ollamaReasoning(
  capabilities: readonly string[],
  family: string | undefined,
): ModelReasoning | undefined {
  if (!capabilities.includes("thinking")) return undefined;
  return family === "gptoss"
    ? {
        mandatory: true,
        defaultEnabled: true,
        supportedEfforts: [...GPT_OSS_EFFORTS],
        defaultEffort: "medium",
      }
    : { mandatory: false, defaultEnabled: true, supportedEfforts: [] };
}

function ollamaThink(effort: string | undefined): ChatRequest["think"] {
  if (effort === "off") return false;
  if (effort === "on") return true;
  return GPT_OSS_EFFORTS.find((level) => level === effort);
}

export async function streamOllamaChat(
  request: LlmChatRequest,
): Promise<LlmChatStream> {
  const think = ollamaThink(request.reasoningEffort);
  const stream = await getOllamaClient().chat({
    model: request.model,
    messages: toOllamaMessages(request.messages),
    tools: request.tools,
    stream: true,
    ...(think === undefined ? {} : { think }),
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
