import { z } from "zod";
import type { EnvironmentSettings } from "../../src/env";
import { globalApiJson } from "../lib/api";
import type { ComfyUIConfigPayload, SearXNGConfigPayload } from "../types";

const environmentSchema = z.object({
  ollamaHost: z.boolean(),
  comfyuiHost: z.boolean(),
  searxngHost: z.boolean(),
}) satisfies z.ZodType<EnvironmentSettings>;

const hostConfigSchema = z.object({ host: z.string() });

const comfyUIConfigSchema = z.object({
  host: z.string(),
  defaultModel: z.string(),
  defaultWidth: z.number(),
  defaultHeight: z.number(),
  negativePrompt: z.string(),
}) satisfies z.ZodType<ComfyUIConfigPayload>;

const connectionTestSchema = z.object({
  ok: z.boolean(),
  version: z.string().optional(),
  error: z.string().optional(),
});

export async function loadEnvironmentSettings(
  signal?: AbortSignal,
): Promise<EnvironmentSettings> {
  return environmentSchema.parse(
    await globalApiJson<unknown>("/api/settings/environment", { signal }),
  );
}

export async function saveOllamaConfig(host: string) {
  return hostConfigSchema.parse(
    await globalApiJson<unknown>("/api/ollama/config", {
      method: "PUT",
      json: { host },
      errorMessage: "Failed to save Ollama URL",
    }),
  );
}

export async function saveComfyUIConfig(
  config: ComfyUIConfigPayload,
): Promise<ComfyUIConfigPayload> {
  return comfyUIConfigSchema.parse(
    await globalApiJson<unknown>("/api/comfyui/config", {
      method: "PUT",
      json: config,
      errorMessage: "Failed to save ComfyUI settings",
    }),
  );
}

export async function saveSearXNGConfig(config: SearXNGConfigPayload) {
  return hostConfigSchema.parse(
    await globalApiJson<unknown>("/api/searxng/config", {
      method: "PUT",
      json: config,
      errorMessage: "Failed to save SearXNG settings",
    }),
  );
}

export async function loadComfyUIModels(): Promise<string[]> {
  return z
    .object({ models: z.array(z.string()) })
    .parse(await globalApiJson<unknown>("/api/comfyui/models")).models;
}

/** Tests an unsaved server address; resolves with the reported version, if any. */
export async function testServiceHost(
  service: "ollama" | "comfyui" | "searxng",
  host: string,
): Promise<{ version?: string }> {
  const result = connectionTestSchema.parse(
    await globalApiJson<unknown>(`/api/${service}/test`, {
      method: "POST",
      json: { host },
    }),
  );
  if (!result.ok) throw new Error(result.error || "Connection failed");
  return { version: result.version };
}
