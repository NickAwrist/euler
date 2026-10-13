import { z } from "zod";

/** A saved or tested Ollama host; empty uses the client default. */
export const OllamaHostBodySchema = z.object({
  host: z.string().trim().optional().default(""),
});
