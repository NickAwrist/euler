import type { Tool } from "ollama";
import type { LlmMetrics } from "../RunContext";
import type { ImageAttachment } from "../attachments/types";

export type LlmToolCall = {
  id?: string;
  type?: "function";
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
};

export type LlmMessage = {
  role: string;
  content: string;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
  reasoning?: string;
  reasoning_details?: unknown[];
  images?: LlmImage[];
};

export type LlmImage = ImageAttachment & {
  data: string;
};

export type LlmChatRequest = {
  model: string;
  messages: LlmMessage[];
  tools: Tool[];
  reasoningEffort?: string;
};

export type LlmStreamChunk = {
  contentDelta?: string;
  thinkingDelta?: string;
  toolCalls?: LlmToolCall[];
  reasoningDetails?: unknown[];
  metrics?: LlmMetrics;
  done?: boolean;
};

export interface LlmChatStream extends AsyncIterable<LlmStreamChunk> {
  abort(): void;
}

export type ModelProvider = "ollama" | "openrouter";

export type ResolvedModel = {
  provider: ModelProvider;
  model: string;
};
