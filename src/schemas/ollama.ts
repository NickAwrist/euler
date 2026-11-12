import { z } from "zod";

/** How much context Ollama loads a model with. */
export const ollamaContextWindowSchema = z
  .enum(["low", "medium", "high"])
  .catch("low");
export type OllamaContextWindow = z.infer<typeof ollamaContextWindowSchema>;
