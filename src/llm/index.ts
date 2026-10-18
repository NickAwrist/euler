import { streamChatGptChat } from "./chatGptProvider";
import { resolveModelSelection } from "./modelSelection";
import { streamOllamaChat } from "./ollamaProvider";
import { streamOpenRouterChat } from "./openRouterProvider";
import type { LlmChatRequest, LlmChatStream } from "./types";

export async function streamModelChat(
  request: LlmChatRequest,
): Promise<LlmChatStream> {
  const resolved = resolveModelSelection(request.model);
  const providerRequest = { ...request, model: resolved.model };
  if (resolved.provider === "chatgpt")
    return streamChatGptChat(providerRequest);
  return resolved.provider === "openrouter"
    ? streamOpenRouterChat(providerRequest)
    : streamOllamaChat(providerRequest);
}

export { openRouterModelId, resolveModelSelection } from "./modelSelection";
export type { LlmImage, LlmMessage, LlmToolCall } from "./types";
