import type { ImagePreferences } from "../../src/gen/euler/v1/preferences_pb";
import type { OllamaContextWindow } from "../../src/gen/euler/v1/providers_pb";
import type { MessageFields } from "./messageFields";

type ImageFields = MessageFields<ImagePreferences>;

/** The ComfyUI form's fields: the server-wide address and the user's image defaults. */
export type ComfyUIConfigPayload = Partial<ImageFields> & { host?: string };

/** Saved ComfyUI settings, with the address in effect. */
export type ComfyUIConfigState = ImageFields & {
  host: string;
  effectiveHost: string;
};

/** The Ollama form's edited fields, both server-wide. */
export type OllamaConfigPayload = {
  host?: string;
  contextWindow?: OllamaContextWindow;
};
