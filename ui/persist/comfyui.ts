import type {
  GetComfyUiConfigResponse,
  UpdateComfyUiConfigResponse,
} from "../../src/gen/euler/v1/providers_pb";
import { providerClient } from "../lib/rpc";
import type { ComfyUIConfigPayload, ComfyUIConfigState } from "../types";

function state({
  config,
  image,
}: GetComfyUiConfigResponse | UpdateComfyUiConfigResponse): ComfyUIConfigState {
  return {
    host: config?.host ?? "",
    effectiveHost: config?.effectiveHost ?? "",
    defaultModel: image?.defaultModel ?? "",
    defaultWidth: image?.defaultWidth ?? 0,
    defaultHeight: image?.defaultHeight ?? 0,
    negativePrompt: image?.negativePrompt ?? "",
  };
}

export async function fetchComfyUIConfig(): Promise<ComfyUIConfigState> {
  return state(await providerClient.getComfyUiConfig({}));
}

export async function saveComfyUIConfig({
  host,
  ...image
}: ComfyUIConfigPayload): Promise<ComfyUIConfigState> {
  return state(await providerClient.updateComfyUiConfig({ host, image }));
}
