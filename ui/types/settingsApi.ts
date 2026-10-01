import type { ComfyUIConfigPut } from "../../src/schemas/comfyui";
/** Payload for PUT /api/comfyui/config (and Settings save callback). */
export type ComfyUIConfigPayload = ComfyUIConfigPut;

/** Payload for PUT /api/searxng/config (and Settings save callback). */
export interface SearXNGConfigPayload {
  host: string;
}
