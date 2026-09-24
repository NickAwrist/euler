import { DEFAULT_SEARXNG_HOST, envConfig } from "../env";
import { getDb } from "./connection";
import {
  COMFYUI_DEFAULT_HEIGHT_KEY,
  COMFYUI_DEFAULT_MODEL_KEY,
  COMFYUI_DEFAULT_WIDTH_KEY,
  COMFYUI_HOST_KEY,
  COMFYUI_NEGATIVE_PROMPT_KEY,
  DEFAULT_COMFYUI_NEGATIVE_PROMPT,
  OLLAMA_HOST_KEY,
  OPENROUTER_API_KEY_KEY,
  SEARXNG_HOST_KEY,
} from "./constants";

/** Explicit environment configuration takes precedence over saved UI settings. */
export function getOllamaHost(): string {
  return envConfig.ollamaHost || getAppSetting(OLLAMA_HOST_KEY);
}

export function setOllamaHost(host: string): void {
  getDb().run(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [OLLAMA_HOST_KEY, host.trim()],
  );
}

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

export function getComfyUIHost(): string {
  return envConfig.comfyuiHost || getAppSetting(COMFYUI_HOST_KEY);
}

export function setComfyUIHost(host: string): void {
  setAppSetting(COMFYUI_HOST_KEY, host);
}

export function getComfyUIDefaultModel(): string {
  return getAppSetting(COMFYUI_DEFAULT_MODEL_KEY);
}

export function setComfyUIDefaultModel(model: string): void {
  setAppSetting(COMFYUI_DEFAULT_MODEL_KEY, model);
}

export function getComfyUIImageSize(): { width: number; height: number } {
  const w = Number.parseInt(getAppSetting(COMFYUI_DEFAULT_WIDTH_KEY), 10);
  const h = Number.parseInt(getAppSetting(COMFYUI_DEFAULT_HEIGHT_KEY), 10);
  return { width: w > 0 ? w : 1440, height: h > 0 ? h : 1440 };
}

export function setComfyUIImageSize(width: number, height: number): void {
  setAppSetting(COMFYUI_DEFAULT_WIDTH_KEY, String(width));
  setAppSetting(COMFYUI_DEFAULT_HEIGHT_KEY, String(height));
}

export function getComfyUINegativePrompt(): string {
  const row = getDb()
    .query("SELECT value FROM app_settings WHERE key = ?")
    .get(COMFYUI_NEGATIVE_PROMPT_KEY) as { value: string } | null;
  if (row === null) return DEFAULT_COMFYUI_NEGATIVE_PROMPT;
  return row.value.trim();
}

export function setComfyUINegativePrompt(value: string): void {
  setAppSetting(COMFYUI_NEGATIVE_PROMPT_KEY, value);
}

export function getSearXNGHost(): string {
  return envConfig.searxngHost || getAppSetting(SEARXNG_HOST_KEY);
}

export function setSearXNGHost(host: string): void {
  const trimmed = host.trim();
  setAppSetting(
    SEARXNG_HOST_KEY,
    trimmed === DEFAULT_SEARXNG_HOST ? "" : trimmed,
  );
}

export function getOpenRouterApiKey(): string {
  return envConfig.openrouterApiKey || getAppSetting(OPENROUTER_API_KEY_KEY);
}

export function setOpenRouterApiKey(key: string): void {
  setAppSetting(OPENROUTER_API_KEY_KEY, key);
}
