import { z } from "zod";
import { ImageAttachmentSchema } from "../attachments/types";
export const ModelMessageSchema = z.object({
  role: z.string(),
  content: z.string().default(""),
  tool_calls: z
    .array(
      z.object({
        id: z.string().optional(),
        type: z.literal("function").optional(),
        function: z.object({
          name: z.string(),
          arguments: z.union([z.string(), z.record(z.string(), z.unknown())]),
        }),
      }),
    )
    .optional(),
  tool_call_id: z.string().optional(),
  reasoning: z.string().optional(),
  reasoning_details: z.array(z.unknown()).optional(),
  images: z
    .array(ImageAttachmentSchema.extend({ data: z.string().default("") }))
    .optional(),
});
