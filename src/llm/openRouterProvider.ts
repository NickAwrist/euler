import { getOpenRouterApiKey } from "../db/index";
import { compactReasoningDetails } from "./reasoningDetails";
import type {
  LlmChatRequest,
  LlmChatStream,
  LlmStreamChunk,
  LlmToolCall,
} from "./types";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

function toOpenRouterMessages(messages: LlmChatRequest["messages"]) {
  return messages.map(({ images, ...message }) => ({
    ...message,
    ...(images?.length
      ? {
          content: [
            ...(message.content
              ? [{ type: "text" as const, text: message.content }]
              : []),
            ...images.map((image) => ({
              type: "image_url" as const,
              image_url: {
                url: `data:${image.mimeType};base64,${image.data}`,
              },
            })),
          ],
        }
      : {}),
  }));
}

type OpenRouterToolDelta = {
  index?: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
};

type OpenRouterChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      reasoning_details?: unknown[];
      tool_calls?: OpenRouterToolDelta[];
    };
  }>;
  usage?: {
    cost?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string; code?: number | string };
};

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  }
  return `OpenRouter request failed (${status})`;
}

function reasoningText(
  delta: NonNullable<OpenRouterChunk["choices"]>[number]["delta"],
): string {
  if (typeof delta?.reasoning === "string") return delta.reasoning;
  if (typeof delta?.reasoning_content === "string") {
    return delta.reasoning_content;
  }
  if (!Array.isArray(delta?.reasoning_details)) return "";
  return delta.reasoning_details
    .map((detail) => {
      if (!detail || typeof detail !== "object") return "";
      const value = detail as { text?: unknown; summary?: unknown };
      if (typeof value.text === "string") return value.text;
      return typeof value.summary === "string" ? value.summary : "";
    })
    .join("");
}

class ThoughtTagParser {
  private buffer = "";
  private thinking = false;

  push(delta: string, final = false): { content: string; thinking: string } {
    this.buffer += delta;
    let content = "";
    let thinking = "";
    const open = /<(?:think|thought)>/i;
    const close = /<\/(?:think|thought)>/i;

    while (this.buffer.length > 0) {
      const match = (this.thinking ? close : open).exec(this.buffer);
      if (match?.index !== undefined) {
        const text = this.buffer.slice(0, match.index);
        if (this.thinking) thinking += text;
        else content += text;
        this.buffer = this.buffer.slice(match.index + match[0].length);
        this.thinking = !this.thinking;
        continue;
      }

      if (!final) {
        const lastOpen = this.buffer.lastIndexOf("<");
        if (lastOpen >= 0) {
          const suffix = this.buffer.slice(lastOpen).toLowerCase();
          const couldBeTag = [
            "<think>",
            "<thought>",
            "</think>",
            "</thought>",
          ].some((tag) => tag.startsWith(suffix));
          if (couldBeTag) {
            const text = this.buffer.slice(0, lastOpen);
            if (this.thinking) thinking += text;
            else content += text;
            this.buffer = suffix;
            break;
          }
        }
      }

      if (this.thinking) thinking += this.buffer;
      else content += this.buffer;
      this.buffer = "";
    }

    return { content, thinking };
  }
}

function updateToolCalls(
  builders: Map<number, LlmToolCall>,
  deltas: OpenRouterToolDelta[] | undefined,
): void {
  for (const delta of deltas ?? []) {
    const index = delta.index ?? 0;
    const current = builders.get(index) ?? {
      type: "function" as const,
      function: { name: "", arguments: "" },
    };
    if (delta.id) current.id = delta.id;
    if (delta.type) current.type = delta.type;
    if (delta.function?.name) current.function.name += delta.function.name;
    if (delta.function?.arguments) {
      current.function.arguments = `${current.function.arguments}${delta.function.arguments}`;
    }
    builders.set(index, current);
  }
}

function parseEventData(block: string): string | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data || null;
}

async function* openRouterChunks(
  response: Response,
): AsyncGenerator<LlmStreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OpenRouter returned no response body");

  const decoder = new TextDecoder();
  const tagParser = new ThoughtTagParser();
  const toolCalls = new Map<number, LlmToolCall>();
  const reasoningDetails: unknown[] = [];
  let buffer = "";
  let metrics: LlmStreamChunk["metrics"];
  let firstOutputAt: number | undefined;

  const markOutputStarted = (payload: OpenRouterChunk): void => {
    if (firstOutputAt !== undefined) return;
    const delta = payload.choices?.[0]?.delta;
    if (
      delta?.content ||
      delta?.reasoning ||
      delta?.reasoning_content ||
      delta?.reasoning_details?.length ||
      delta?.tool_calls?.length
    ) {
      firstOutputAt = performance.now();
    }
  };

  const handleBlock = (block: string): LlmStreamChunk | null => {
    const data = parseEventData(block);
    if (!data || data === "[DONE]") return null;
    let payload: OpenRouterChunk;
    try {
      payload = JSON.parse(data) as OpenRouterChunk;
    } catch {
      throw new Error("OpenRouter returned an invalid streaming response");
    }
    if (payload.error) {
      throw new Error(errorMessage(payload, Number(payload.error.code) || 502));
    }

    markOutputStarted(payload);

    if (payload.usage) {
      metrics = {
        ...(typeof payload.usage.cost === "number"
          ? { cost: payload.usage.cost }
          : {}),
        ...(typeof payload.usage.prompt_tokens === "number"
          ? { promptTokens: payload.usage.prompt_tokens }
          : {}),
        ...(typeof payload.usage.completion_tokens === "number"
          ? { outputTokens: payload.usage.completion_tokens }
          : {}),
      };
    }

    const delta = payload.choices?.[0]?.delta;
    if (!delta) return null;
    if (delta.reasoning_details?.length) {
      reasoningDetails.push(...delta.reasoning_details);
    }
    updateToolCalls(toolCalls, delta.tool_calls);
    const tagged = tagParser.push(delta.content ?? "");
    const thinkingDelta = reasoningText(delta) + tagged.thinking;
    return {
      ...(tagged.content ? { contentDelta: tagged.content } : {}),
      ...(thinkingDelta ? { thinkingDelta } : {}),
      ...(delta.tool_calls?.length
        ? { toolCalls: Array.from(toolCalls.values()) }
        : {}),
    };
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const chunk = handleBlock(block);
      if (chunk) yield chunk;
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const chunk = handleBlock(buffer);
    if (chunk) yield chunk;
  }
  const trailing = tagParser.push("", true);
  if (trailing.content || trailing.thinking) {
    yield {
      ...(trailing.content ? { contentDelta: trailing.content } : {}),
      ...(trailing.thinking ? { thinkingDelta: trailing.thinking } : {}),
    };
  }
  const outputTokens = metrics?.outputTokens;
  if (firstOutputAt !== undefined && outputTokens !== undefined) {
    const outputDurationMs = Math.max(performance.now() - firstOutputAt, 0.001);
    metrics = {
      ...metrics,
      outputDurationMs,
      tokensPerSecond: outputTokens / (outputDurationMs / 1000),
    };
  }
  yield {
    done: true,
    ...(reasoningDetails.length > 0
      ? { reasoningDetails: compactReasoningDetails(reasoningDetails) }
      : {}),
    ...(toolCalls.size > 0
      ? { toolCalls: Array.from(toolCalls.values()) }
      : {}),
    ...(metrics ? { metrics } : {}),
  };
}

export async function streamOpenRouterChat(
  request: LlmChatRequest,
): Promise<LlmChatStream> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error("OpenRouter API key is not configured");
  }

  const controller = new AbortController();
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost",
      "X-Title": "Orbis Agents",
    },
    body: JSON.stringify({
      model: request.model,
      messages: toOpenRouterMessages(request.messages),
      tools: request.tools,
      stream: true,
      stream_options: { include_usage: true },
      ...(request.reasoningEffort
        ? {
            reasoning:
              request.reasoningEffort === "off" ||
              request.reasoningEffort === "none"
                ? { enabled: false, effort: "none" }
                : request.reasoningEffort === "on"
                  ? { enabled: true }
                  : { effort: request.reasoningEffort },
          }
        : {}),
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(errorMessage(body, response.status));
  }

  return {
    abort: () => controller.abort(),
    [Symbol.asyncIterator]: () => openRouterChunks(response),
  };
}
