import { z } from "zod";

const UniqueStringArraySchema = z
  .array(z.string().trim().min(1, "Items must not be empty"))
  .optional()
  .transform((items) => (items ? [...new Set(items)] : []));

export const AgentWriteSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  description: z.string().trim().optional().default(""),
  system_prompt: z.string().trim().optional().default(""),
  tools: UniqueStringArraySchema.default([]),
  skill_ids: UniqueStringArraySchema.default([]),
  delegate_agent_ids: UniqueStringArraySchema.default([]),
});

export type AgentWriteBody = z.infer<typeof AgentWriteSchema>;

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  system_prompt: z.string(),
  is_default: z.number(),
  tools: z.array(z.string()),
  skill_ids: z.array(z.string()),
  delegate_agent_ids: z.array(z.string()),
  created_at: z.number(),
  updated_at: z.number(),
});

export type AgentData = z.infer<typeof AgentSchema>;

export const AgentListResponseSchema = z.object({
  agents: z.array(AgentSchema),
});

export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;
