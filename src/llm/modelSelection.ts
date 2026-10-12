import type { ResolvedModel } from "./types";

const OPENROUTER_MODEL_PREFIX = "openrouter:";

export function openRouterModelId(route: string): string {
  return `${OPENROUTER_MODEL_PREFIX}${route}`;
}

export function resolveModelSelection(selection: string): ResolvedModel {
  const trimmed = selection.trim();
  return trimmed.startsWith(OPENROUTER_MODEL_PREFIX)
    ? {
        provider: "openrouter",
        model: trimmed.slice(OPENROUTER_MODEL_PREFIX.length),
      }
    : { provider: "ollama", model: trimmed };
}
