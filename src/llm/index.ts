import { streamChatGptChat } from "./chatGptProvider";
import { resolveModelSelection } from "./modelSelection";
import { streamOllamaChat } from "./ollamaProvider";
import {
  streamOpenRouterChat,
  streamVercelGatewayChat,
} from "./openRouterProvider";
import type { LlmChatRequest, LlmChatStream } from "./types";

export async function streamModelChat(
  request: LlmChatRequest,
): Promise<LlmChatStream> {
  const resolved = resolveModelSelection(request.model);
  const providerRequest = { ...request, model: resolved.model };
  if (resolved.provider === "chatgpt")
    return streamChatGptChat(providerRequest);
  if (resolved.provider === "openrouter")
    return streamOpenRouterChat(providerRequest);
  if (resolved.provider === "vercel_gateway")
    return streamVercelGatewayChat(providerRequest);
  return streamOllamaChat(providerRequest);
}

export {
  gatewayModelId,
  openRouterModelId,
  resolveModelSelection,
  vercelGatewayModelId,
} from "./modelSelection";
export type {
  CatalogProvider,
  LlmImage,
  LlmMessage,
  LlmToolCall,
} from "./types";
