import type { Database } from "bun:sqlite";
import { RE2JS } from "re2js";
import { z } from "zod";
import {
  MAX_TOOL_PERMISSION_RULES,
  ToolPermissionConditionSchema,
  ToolPermissionRuleSchema,
  ToolPermissionsSchema,
} from "../schemas/toolPermissions";

const StoredPreferencesSchema = z.record(z.string(), z.json());
const FormerRuleSchema = ToolPermissionRuleSchema.extend({
  condition: z.union([
    ToolPermissionConditionSchema,
    z
      .object({
        kind: z.literal("argument"),
        field: z.string().trim().min(1).max(200),
        match: z.literal("prefix"),
        value: z.string().min(1).max(10000),
      })
      .strict(),
  ]),
});
const FormerToolPermissionsSchema = ToolPermissionsSchema.extend({
  defaultAction: z.enum(["allow", "ask"]).optional(),
  rules: z.array(FormerRuleSchema).max(MAX_TOOL_PERMISSION_RULES).default([]),
});

/** Removing former settings and match types marks rows as migrated. */
export function migrateToolPermissions(db: Database): void {
  db.transaction(() => {
    const rows = db
      .query(
        `SELECT owner_uuid, value FROM user_preferences
         WHERE json_type(value, '$.toolPermissions.defaultAction') IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM json_each(user_preferences.value, '$.toolPermissions.rules') AS rule
           WHERE json_extract(rule.value, '$.condition.match') = 'prefix'
         )`,
      )
      .all() as { owner_uuid: string; value: string }[];
    for (const row of rows) {
      const preferences = StoredPreferencesSchema.parse(JSON.parse(row.value));
      const former = FormerToolPermissionsSchema.parse(
        preferences.toolPermissions,
      );
      const rules = former.rules.map((rule) =>
        rule.condition.kind === "argument" && rule.condition.match === "prefix"
          ? {
              ...rule,
              condition: {
                ...rule.condition,
                match: "regex" as const,
                value: `^${RE2JS.quote(rule.condition.value)}`,
              },
            }
          : rule,
      );
      preferences.toolPermissions = ToolPermissionsSchema.parse({
        rules:
          former.defaultAction === "ask"
            ? [
                {
                  id: crypto.randomUUID(),
                  tool: "*",
                  action: "ask",
                  condition: { kind: "any" },
                },
                ...rules,
              ]
            : rules,
      });
      db.run("UPDATE user_preferences SET value = ? WHERE owner_uuid = ?", [
        JSON.stringify(preferences),
        row.owner_uuid,
      ]);
    }
  })();
}
