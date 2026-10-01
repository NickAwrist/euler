/** Payload for PUT /api/comfyui/config (and Settings save callback). */
export interface ComfyUIConfigPayload {
  host: string;
  defaultModel: string;
  defaultWidth: number;
  defaultHeight: number;
  negativePrompt: string;
}
