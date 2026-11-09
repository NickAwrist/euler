import type { GetEnvironmentResponse } from "../../src/gen/euler/v1/preferences_pb";
import { preferenceClient, providerClient } from "../lib/rpc";
import type { MessageFields } from "../types";

/** Which provider addresses the server's environment sets. */
export type EnvironmentSettings = MessageFields<GetEnvironmentResponse>;

export async function loadEnvironmentSettings(
  signal?: AbortSignal,
): Promise<EnvironmentSettings> {
  return preferenceClient.getEnvironment({}, { signal });
}

export async function saveOllamaConfig(host: string) {
  return (await providerClient.updateOllamaConfig({ host })).config!;
}

export async function loadComfyUIModels(): Promise<string[]> {
  return (await providerClient.listComfyUiModels({})).models;
}

/** Tests an unsaved server address; resolves with the reported version, if any. */
export async function testServiceHost(
  service: "ollama" | "comfyui",
  host: string,
): Promise<{ version?: string }> {
  const { result } =
    service === "ollama"
      ? await providerClient.testOllamaHost({ host })
      : await providerClient.testComfyUiHost({ host });
  if (!result?.ok) throw new Error(result?.error || "Connection failed");
  return { version: result.version };
}
