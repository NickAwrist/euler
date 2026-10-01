import { z } from "zod";
const LabelSchema = z.string().max(120);
export const ToolBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string(),
    label: LabelSchema.optional(),
  }),
  z.object({
    kind: z.literal("code"),
    text: z.string(),
    language: z.string().max(32).optional(),
    label: LabelSchema.optional(),
  }),
  z.object({
    kind: z.literal("fields"),
    fields: z
      .array(z.object({ label: LabelSchema, value: z.string() }))
      .max(32),
  }),
]);
export const ToolContentSchema = z.object({
  blocks: z.array(ToolBlockSchema).max(32),
});
export const ToolInputSchema = z.object({
  summary: z.string().min(1).max(300),
  content: ToolContentSchema,
});
export const ToolContentUpdateSchema = z.object({
  mode: z.enum(["append", "replace"]),
  content: ToolContentSchema,
});
export type ToolContent = z.infer<typeof ToolContentSchema>;
export type ToolInput = z.infer<typeof ToolInputSchema>;
export type ToolContentUpdate = z.infer<typeof ToolContentUpdateSchema>;
