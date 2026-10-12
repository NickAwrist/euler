import { z } from "zod";
import { compileToolRegex } from "../permissions/toolRegex";

// One extra rule accommodates conversion of the former approval default.
export const MAX_TOOL_PERMISSION_RULES = 101;
export const ToolArgumentsSchema = z.record(z.string(), z.json());
export const ToolPermissionValueSchema = z.union([
  z.string().min(1).max(10000),
  z.number().finite(),
  z.boolean(),
]);
export const ToolPermissionConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }).strict(),
  z
    .object({
      kind: z.literal("argument"),
      field: z.string().trim().min(1).max(200),
      match: z.enum(["exact", "regex"]),
      // Escaping a former 10,000-character prefix can double its length, plus ^.
      value: z.union([ToolPermissionValueSchema, z.string().min(1).max(20001)]),
    })
    .strict()
    .superRefine((condition, context) => {
      if (condition.match === "exact") {
        const parsed = ToolPermissionValueSchema.safeParse(condition.value);
        if (!parsed.success)
          for (const issue of parsed.error.issues)
            context.addIssue({ ...issue, path: ["value", ...issue.path] });
        return;
      }
      if (typeof condition.value !== "string") {
        context.addIssue({
          code: "custom",
          message: "Regex requires a text pattern",
          path: ["value"],
        });
        return;
      }
      try {
        compileToolRegex(condition.value);
      } catch {
        context.addIssue({
          code: "custom",
          message: "Invalid or unsupported regex",
          path: ["value"],
        });
      }
    }),
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
    }),
  ),
});
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
