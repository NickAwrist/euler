import { z } from "zod";
import { chatGptAccessToken } from "../models/chatgpt";
import type {
  LlmChatRequest,
  LlmChatStream,
  LlmStreamChunk,
  LlmToolCall,
} from "./types";

const reasoningItemSchema = z.object({
  type: z.literal("reasoning"),
  id: z.string(),
  encrypted_content: z.string(),
  summary: z.array(
    z.object({ type: z.literal("summary_text"), text: z.string() }),
  ),
});

export function chatGptInput(
  messages: LlmChatRequest["messages"],
): Record<string, unknown>[] {
  return messages.flatMap((message): Record<string, unknown>[] => {
    if (message.role === "tool") {
      if (!message.tool_call_id)
        throw new Error("ChatGPT tool output is missing its call ID");
      return [
        {
          type: "function_call_output",
          call_id: message.tool_call_id,
          output: message.content,
        },
      ];
    }
    const content = message.images?.length
      ? [
          { type: "input_text", text: message.content },
          ...message.images.map((image) => ({
            type: "input_image",
            image_url: `data:${image.mimeType};base64,${image.data}`,
          })),
        ]
      : message.content;
    return [
      ...(message.reasoning_details ?? []).flatMap((detail) => {
        const parsed = reasoningItemSchema.safeParse(detail);
        return parsed.success ? [parsed.data] : [];
      }),
      ...(message.content || message.images?.length
        ? [{ role: message.role, content }]
        : []),
      ...(message.tool_calls ?? []).map((call) => ({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments:
          typeof call.function.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function.arguments),
      })),
    ];
  });
}
const eventSchema = z.object({
  code: z.string().optional(),
  type: z.string(),
  delta: z.string().optional(),
  item: z
    .object({
      type: z.string(),
      call_id: z.string().optional(),
      name: z.string().optional(),
      arguments: z.string().optional(),
      id: z.string().optional(),
      encrypted_content: z.string().optional(),
      summary: z
        .array(z.object({ type: z.literal("summary_text"), text: z.string() }))
        .optional(),
    })
    .optional(),
  response: z
    .object({
      error: z.object({ code: z.string().optional() }).nullish(),
      usage: z
        .object({
          input_tokens: z.number(),
          output_tokens: z.number(),
          input_tokens_details: z
            .object({ cached_tokens: z.number() })
            .optional(),
        })
        .nullish(),
    })
    .optional(),
});
export async function* chatGptChunks(
  response: Response,
): AsyncGenerator<LlmStreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("ChatGPT returned no stream");
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const toolCalls: LlmToolCall[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      if (done && buffer.trim()) blocks.push(buffer);
      for (const block of blocks) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        const event = eventSchema.parse(JSON.parse(data));
        if (event.type === "response.output_text.delta")
          yield { contentDelta: event.delta };
        if (
          event.type === "response.output_item.done" &&
          event.item?.type === "reasoning"
        ) {
          const parsed = reasoningItemSchema.safeParse(event.item);
          if (parsed.success) yield { reasoningDetails: [parsed.data] };
        }
        if (
          event.type === "response.output_item.done" &&
          event.item?.type === "function_call"
        ) {
          const item = event.item;
          if (!item.call_id || !item.name || item.arguments === undefined)
            throw new Error("ChatGPT returned an invalid tool call");
          toolCalls.push({
            id: item.call_id,
            type: "function",
            function: { name: item.name, arguments: item.arguments },
          });
        }
        if (
          ["response.failed", "response.incomplete", "error"].includes(
            event.type,
          )
        )
          throw new Error(
            `ChatGPT inference failed (${event.code ?? event.response?.error?.code ?? event.type})`,
          );
        if (event.type === "response.completed") {
          completed = true;
          const usage = event.response?.usage;
          yield {
            done: true,
            ...(toolCalls.length ? { toolCalls } : {}),
            ...(usage
              ? {
                  metrics: {
                    promptTokens: usage.input_tokens,
                    outputTokens: usage.output_tokens,
                    cachedTokens: usage.input_tokens_details?.cached_tokens,
                  },
                }
              : {}),
          };
          return;
        }
      }
      if (done) break;
    }
    if (!completed) throw new Error("ChatGPT stream ended before completion");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function streamChatGptChat(
  request: LlmChatRequest,
): Promise<LlmChatStream> {
  if (!request.ownerUuid) throw new Error("ChatGPT requires a user UUID");
  const token = await chatGptAccessToken(request.ownerUuid);
  const controller = new AbortController();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: request.model,
      input: chatGptInput(request.messages),
      include: ["reasoning.encrypted_content"],
      store: false,
      stream: true,
      tools: request.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: false,
      })),
    }),
    signal: controller.signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `ChatGPT request failed (${response.status}). Check your connection and plan limits.`,
    );
  }
  return {
    abort: () => controller.abort(),
    [Symbol.asyncIterator]: () => chatGptChunks(response),
  };
}
