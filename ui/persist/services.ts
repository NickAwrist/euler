import type {
  GetEnvironmentResponse,
  ImageProvider,
} from "../../src/gen/euler/v1/preferences_pb";
import type {
  ImageModel,
  OllamaContextWindow,
} from "../../src/gen/euler/v1/providers_pb";
import { preferenceClient, providerClient, withErrorMessage } from "../lib/rpc";
import type { MessageFields } from "../types";

/** Which provider addresses the server's environment sets. */
export type EnvironmentSettings = MessageFields<GetEnvironmentResponse>;

export async function loadEnvironmentSettings(
  signal?: AbortSignal,
): Promise<EnvironmentSettings> {
  return preferenceClient.getEnvironment({}, { signal });
}

export async function saveOllamaConfig(host: string) {
  return (
    await withErrorMessage(
      providerClient.updateOllamaConfig({ host }),
      "Failed to save Ollama URL",
    )
  ).config!;
}

export async function saveOllamaContextWindow(
  contextWindow: OllamaContextWindow,
) {
  return (
    await withErrorMessage(
      providerClient.setOllamaContextWindow({ contextWindow }),
      "Failed to save Ollama context window",
    )
  ).contextWindow;
}

/** Tests an unsaved Ollama address; resolves with the reported version, if any. */
export async function testOllamaHost(
  host: string,
): Promise<{ version?: string }> {
  const { result } = await providerClient.testOllamaHost({ host });
  if (!result?.ok) throw new Error(result?.error || "Connection failed");
  return { version: result.version };
}

export async function loadImageModels(
  provider?: ImageProvider,
  refresh = false,
): Promise<{ models: ImageModel[]; error?: string }> {
  const response = await providerClient.listImageModels({
    provider,
    refresh,
  });
  return { models: response.models, error: response.error };
}
