import { z } from "zod";
import { compileToolRegex } from "../permissions/toolRegex";
import { DisplayIconSchema } from "./icons";

export const MAX_TOOL_PERMISSION_RULES = 100;
export const ToolArgumentsSchema = z.record(z.string(), z.json());
export const ToolPermissionValueSchema = z.union([
  z.string().min(1).max(10000),
  z.number().finite(),
  z.boolean(),
]);
export const ToolPermissionConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }).strict(),
  z.discriminatedUnion("match", [
    z
      .object({
        kind: z.literal("argument"),
        field: z.string().trim().min(1).max(200),
        match: z.literal("exact"),
        value: ToolPermissionValueSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("argument"),
        field: z.string().trim().min(1).max(200),
        match: z.literal("regex"),
        value: z
          .string()
          .min(1)
          .max(10000)
          .refine((pattern) => {
            try {
              compileToolRegex(pattern);
              return true;
            } catch {
              return false;
            }
          }, "Invalid or unsupported regex"),
      })
      .strict(),
  ]),
  z
    .object({ kind: z.literal("arguments"), value: ToolArgumentsSchema })
    .strict(),
]);
export const ToolPermissionRuleSchema = z
  .object({
    id: z.uuid(),
    tool: z.string().trim().min(1).max(200),
    action: z.enum(["allow", "deny", "ask"]),
    condition: ToolPermissionConditionSchema,
    sessionId: z.string().min(1).max(200).optional(),
    workspacePath: z.string().min(1).max(4096).optional(),
  })
  .strict();
export type ToolPermissionRule = z.infer<typeof ToolPermissionRuleSchema>;
export const ToolPermissionsSchema = z
  .object({
    rules: z
      .array(ToolPermissionRuleSchema)
      .max(MAX_TOOL_PERMISSION_RULES)
      .default([]),
  })
  .strict();
export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>;
export const ToolPermissionFieldSchema = z.object({
  path: z.string().min(1).max(200),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().optional(),
  values: z.array(ToolPermissionValueSchema).optional(),
});
export type ToolPermissionField = z.infer<typeof ToolPermissionFieldSchema>;
export const ToolPermissionToolsSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      fields: z.array(ToolPermissionFieldSchema),
      icons: z.array(DisplayIconSchema).optional(),
    }),
  ),
});
export const ToolApprovalSchema = z.object({
  id: z.uuid(),
  sessionId: z.string(),
  agentId: z.string(),
  agentTitle: z.string(),
  tool: z.string(),
  icons: z.array(DisplayIconSchema).optional(),
  arguments: ToolArgumentsSchema,
  workspacePath: z.string(),
  reason: z.string(),
  matchingScope: z.string(),
});
export type ToolApproval = z.infer<typeof ToolApprovalSchema>;
export const ToolApprovalResponseSchema = z
  .object({
    decision: z.enum(["allow_once", "allow_matching", "deny"]),
  })
  .strict();
export type ToolApprovalResponse = z.infer<typeof ToolApprovalResponseSchema>;
export const ToolApprovalResultSchema = z.object({
  ok: z.literal(true),
  rule: ToolPermissionRuleSchema.optional(),
});
