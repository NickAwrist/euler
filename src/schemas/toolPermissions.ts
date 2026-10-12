import { z } from "zod";

export const ToolArgumentsSchema = z.record(z.string(), z.json());
export const ToolPermissionConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }).strict(),
  z
    .object({
      kind: z.literal("argument"),
      field: z.string().trim().min(1).max(200),
      match: z.enum(["exact", "prefix"]),
      value: z.string().min(1).max(10000),
    })
    .strict(),
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
    defaultAction: z.enum(["allow", "ask"]).default("allow"),
    rules: z.array(ToolPermissionRuleSchema).max(100).default([]),
  })
  .strict();
export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>;
export const ToolApprovalSchema = z.object({
  id: z.uuid(),
  sessionId: z.string(),
  agentId: z.string(),
  agentTitle: z.string(),
  tool: z.string(),
  arguments: ToolArgumentsSchema,
  background: z.boolean(),
  workspacePath: z.string(),
  reason: z.string(),
  createdAt: z.number(),
  matchingRule: ToolPermissionRuleSchema,
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
