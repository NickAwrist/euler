import {
  type ComfyUIConfigPut,
  ComfyUIConfigResponseSchema,
} from "../../src/schemas/comfyui";
import { userApiJson } from "../lib/api";

export async function fetchComfyUIConfig() {
  return ComfyUIConfigResponseSchema.parse(
    await userApiJson<unknown>("/api/comfyui/config"),
  );
}
export async function saveComfyUIConfig(config: ComfyUIConfigPut) {
  return ComfyUIConfigResponseSchema.parse(
    await userApiJson<unknown>("/api/comfyui/config", {
      method: "PUT",
      json: config,
    }),
  );
}
