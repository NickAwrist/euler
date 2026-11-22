import type { OllamaContextWindow } from "../../src/gen/euler/v1/providers_pb";

/** The Ollama form's edited fields, both server-wide. */
export type OllamaConfigPayload = {
  host?: string;
  contextWindow?: OllamaContextWindow;
};
