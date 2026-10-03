import { z } from "zod";
import { MessageAttachmentSchema } from "../attachments/types";

export const WireStepSchema = z.record(z.string(), z.unknown());

/** An earlier assistant reply to the same message, kept on regenerate. */
export const MessageVersionSchema = z.object({
  content: z.string(),
  steps: z.array(WireStepSchema).optional(),
  attachments: z.array(MessageAttachmentSchema).optional(),
});

export type MessageVersion = z.infer<typeof MessageVersionSchema>;

export const WireMessageSchema = z.object({
  id: z.number().optional(),
  activationId: z.string().optional(),
  role: z.string(),
  content: z.string(),
  steps: z.array(WireStepSchema).optional(),
  attachments: z.array(MessageAttachmentSchema).optional(),
  versions: z.array(MessageVersionSchema).optional(),
});

export type WireMessageInput = z.infer<typeof WireMessageSchema>;

export const RunMetadataSchema = z.object({
  systemPrompt: z.string().optional(),
  name: z.string().optional(),
  location: z.string().optional(),
  preferredFormats: z.string().optional(),
  includeCurrentDate: z.boolean().optional(),
});

/** Preview using current configuration, optionally including a draft message. */
export const DebugPromptBodySchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  metadata: RunMetadataSchema.optional(),
  message: z.string().optional(),
});
