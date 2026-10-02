import { z } from "zod";
import type { EnvironmentSettings } from "../../src/env";
import { globalApiJson } from "../lib/api";

const environmentSchema = z.object({
  ollamaHost: z.boolean(),
  comfyuiHost: z.boolean(),
}) satisfies z.ZodType<EnvironmentSettings>;

const hostConfigSchema = z.object({ host: z.string() });

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

export async function loadComfyUIModels(): Promise<string[]> {
  return z
    .object({ models: z.array(z.string()) })
    .parse(await globalApiJson<unknown>("/api/comfyui/models")).models;
}

/** Tests an unsaved server address; resolves with the reported version, if any. */
export async function testServiceHost(
  service: "ollama" | "comfyui",
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
