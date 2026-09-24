import { z } from "zod";
import {
  MAX_IMAGES_PER_MESSAGE,
  MessageAttachmentSchema,
} from "../attachments/types";

export const WireStepSchema = z.record(z.string(), z.unknown());

export const WireMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
  steps: z.array(WireStepSchema).optional(),
  attachments: z.array(MessageAttachmentSchema).optional(),
});

export type WireMessageInput = z.infer<typeof WireMessageSchema>;

const ModelMessageSchema = z.record(z.string(), z.unknown());

export const RunMetadataSchema = z.object({
  systemPrompt: z.string().optional(),
  name: z.string().optional(),
  location: z.string().optional(),
  preferredFormats: z.string().optional(),
  includeCurrentDate: z.boolean().optional(),
});

export const RunBodySchema = z.object({
  sessionId: z.string().min(1).optional(),
  message: z.string().min(1),
  history: z.array(WireMessageSchema),
  model: z.string().optional(),
  reasoningEffort: z.string().trim().min(1).nullish(),
  modelMessages: z.array(ModelMessageSchema).nullable().optional(),
  ephemeral: z.boolean().optional(),
  metadata: RunMetadataSchema.optional(),
  attachmentIds: z.array(z.uuid()).max(MAX_IMAGES_PER_MESSAGE).optional(),
});

export type RunBody = z.infer<typeof RunBodySchema>;

export const AbortRunBodySchema = z.object({
  requestId: z.string().min(1),
});

export type AbortRunBody = z.infer<typeof AbortRunBodySchema>;

/** Preview using current configuration, optionally including a draft message. */
export const DebugPromptBodySchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  metadata: RunMetadataSchema.optional(),
  ephemeral: z.boolean().optional(),
  message: z.string().optional(),
});
