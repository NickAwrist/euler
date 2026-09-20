import { z } from "zod";

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SkillWriteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "name is required")
    .max(64, "name must be 64 characters or fewer")
    .regex(
      SKILL_NAME_PATTERN,
      "name must use lowercase letters, numbers, and single hyphens only",
    ),
  description: z
    .string()
    .trim()
    .min(1, "description is required")
    .max(500, "description must be 500 characters or fewer"),
  instructions: z.string().trim().min(1, "instructions are required"),
});

export type SkillWriteBody = z.infer<typeof SkillWriteSchema>;

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
});

export type SkillData = z.infer<typeof SkillSchema>;

export const SkillListResponseSchema = z.object({
  skills: z.array(SkillSchema),
});

export type SkillListResponse = z.infer<typeof SkillListResponseSchema>;
