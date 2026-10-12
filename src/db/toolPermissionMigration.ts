import type { Database } from "bun:sqlite";
import { z } from "zod";
import { ToolPermissionsSchema } from "../schemas/toolPermissions";

const StoredPreferencesSchema = z.record(z.string(), z.json());
const FormerToolPermissionsSchema = ToolPermissionsSchema.extend({
  defaultAction: z.enum(["allow", "ask"]),
});

/** Removing the old key marks each row as migrated; retries never duplicate rules. */
export function migrateToolPermissionDefaults(db: Database): void {
  db.transaction(() => {
    const rows = db
      .query(
        "SELECT owner_uuid, value FROM user_preferences WHERE json_type(value, '$.toolPermissions.defaultAction') IS NOT NULL",
      )
      .all() as { owner_uuid: string; value: string }[];
    for (const row of rows) {
      const preferences = StoredPreferencesSchema.parse(JSON.parse(row.value));
      const { defaultAction, rules } = FormerToolPermissionsSchema.parse(
        preferences.toolPermissions,
      );
      preferences.toolPermissions = ToolPermissionsSchema.parse({
        rules:
          defaultAction === "ask"
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
