import type { CatalogProvider, ResolvedModel } from "./types";

const OPENROUTER_MODEL_PREFIX = "openrouter:";
const VERCEL_GATEWAY_MODEL_PREFIX = "vercel_gateway:";

export function openRouterModelId(route: string): string {
  return `${OPENROUTER_MODEL_PREFIX}${route}`;
}

export function vercelGatewayModelId(route: string): string {
  return `${VERCEL_GATEWAY_MODEL_PREFIX}${route}`;
}

export function gatewayModelId(
  provider: CatalogProvider,
  route: string,
): string {
  return provider === "vercel_gateway"
    ? vercelGatewayModelId(route)
    : openRouterModelId(route);
}

export function resolveModelSelection(selection: string): ResolvedModel {
  const trimmed = selection.trim();
  if (trimmed.startsWith("chatgpt:"))
    return { provider: "chatgpt", model: trimmed.slice(8) };
  if (trimmed.startsWith(OPENROUTER_MODEL_PREFIX))
    return {
      provider: "openrouter",
      model: trimmed.slice(OPENROUTER_MODEL_PREFIX.length),
    };
  if (trimmed.startsWith(VERCEL_GATEWAY_MODEL_PREFIX))
    return {
      provider: "vercel_gateway",
      model: trimmed.slice(VERCEL_GATEWAY_MODEL_PREFIX.length),
    };
  return { provider: "ollama", model: trimmed };
}
