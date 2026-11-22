import { envConfig } from "../env";
import {
  type OllamaContextWindow,
  ollamaContextWindowSchema,
} from "../schemas/ollama";
import { getDb } from "./connection";
import {
  BRAVE_SEARCH_API_KEY_KEY,
  OLLAMA_CONTEXT_WINDOW_KEY,
  OLLAMA_HOST_KEY,
  OPENROUTER_API_KEY_KEY,
  VERCEL_GATEWAY_API_KEY_KEY,
} from "./constants";

function getAppSetting(key: string): string {
  const row = getDb()
    .query("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | null;
  return row?.value?.trim() ?? "";
}

function setAppSetting(key: string, value: string): void {
  getDb().run(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value.trim()],
  );
}

/** Explicit environment configuration takes precedence over saved UI settings. */
export function getOllamaHost(): string {
  return envConfig.ollamaHost || getAppSetting(OLLAMA_HOST_KEY);
}

export function setOllamaHost(host: string): void {
  setAppSetting(OLLAMA_HOST_KEY, host);
}

export function getOllamaContextWindow(): OllamaContextWindow {
  return ollamaContextWindowSchema.parse(
    getAppSetting(OLLAMA_CONTEXT_WINDOW_KEY),
  );
}

export function setOllamaContextWindow(value: OllamaContextWindow): void {
  setAppSetting(OLLAMA_CONTEXT_WINDOW_KEY, value);
}

export function getOpenRouterApiKey(): string {
  return envConfig.openrouterApiKey || getAppSetting(OPENROUTER_API_KEY_KEY);
}

export function setOpenRouterApiKey(key: string): void {
  setAppSetting(OPENROUTER_API_KEY_KEY, key);
}

export function getVercelGatewayApiKey(): string {
  return (
    envConfig.vercelGatewayApiKey || getAppSetting(VERCEL_GATEWAY_API_KEY_KEY)
  );
}

export function setVercelGatewayApiKey(key: string): void {
  setAppSetting(VERCEL_GATEWAY_API_KEY_KEY, key);
}

export function getBraveSearchApiKey(): string {
  return envConfig.braveSearchApiKey || getAppSetting(BRAVE_SEARCH_API_KEY_KEY);
}

export function setBraveSearchApiKey(key: string): void {
  setAppSetting(BRAVE_SEARCH_API_KEY_KEY, key);
}
