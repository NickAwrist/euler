import { Ollama } from "ollama";
import { getOllamaHost } from "../db/index";
import { providerHostConfig } from "./providerHostConfig";

let cached: { hostKey: string; client: Ollama } | null = null;

function cacheKey(): string {
  return getOllamaHost() || "__default__";
}

/** Singleton client for the configured Ollama base URL (default matches ollama-js: http://127.0.0.1:11434). */
export function getOllamaClient(): Ollama {
  const key = cacheKey();
  if (!cached || cached.hostKey !== key) {
    const stored = getOllamaHost();
    const client = stored ? new Ollama({ host: stored }) : new Ollama();
    cached = { hostKey: key, client };
  }
  return cached.client;
}

export function invalidateOllamaClientCache(): void {
  cached = null;
}

/** The base URL ollama-js derives from `host`, or its default without one. */
export function normalizeOllamaHost(host = ""): string {
  // ollama-js keeps its normalized host on an untyped `config` field.
  const client = host ? new Ollama({ host }) : new Ollama();
  return (client as unknown as { config: { host: string } }).config.host;
}

export function getOllamaHostConfig(): {
  host: string;
  effectiveHost: string;
} {
  return providerHostConfig({
    host: getOllamaHost(),
    fallbackHost: normalizeOllamaHost(),
    normalize: normalizeOllamaHost,
  });
}
