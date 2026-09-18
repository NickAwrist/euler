import { z } from "zod";

export const InputCapability = {
  Text: "text",
  Image: "image",
  File: "file",
  Audio: "audio",
  Video: "video",
} as const;

export type InputCapability =
  (typeof InputCapability)[keyof typeof InputCapability];

const INPUT_CAPABILITY_VALUES = [
  InputCapability.Text,
  InputCapability.Image,
  InputCapability.File,
  InputCapability.Audio,
  InputCapability.Video,
] as const;

export const InputCapabilitySchema = z.enum(INPUT_CAPABILITY_VALUES);

export function parseInputCapabilities(value: unknown): InputCapability[] {
  if (!Array.isArray(value)) return [];

  const capabilities = new Set<InputCapability>();
  for (const entry of value) {
    const parsed = InputCapabilitySchema.safeParse(entry);
    if (parsed.success) capabilities.add(parsed.data);
  }
  return Array.from(capabilities);
}

export const ModelReasoningSchema = z.object({
  mandatory: z.boolean().default(false),
  defaultEnabled: z.boolean().default(false),
  supportedEfforts: z.array(z.string()).default([]),
  defaultEffort: z.string().optional(),
});

export type ModelReasoning = z.infer<typeof ModelReasoningSchema>;

export function parseModelReasoning(value: unknown): ModelReasoning | null {
  if (!value || typeof value !== "object") return null;
  const parsed = ModelReasoningSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
