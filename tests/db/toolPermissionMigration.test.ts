import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrateToolPermissionDefaults } from "../../src/db/toolPermissionMigration";
import { permissionService } from "../../src/permissions/PermissionService";
import { ToolPermissionsSchema } from "../../src/schemas/toolPermissions";
import { capabilitiesSchema } from "../../src/schemas/userPreferences";
import { allToolsRule } from "../helpers/toolPermissions";

test("approval defaults become visible rules without changing exceptions, including a full rule list", () => {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE user_preferences (owner_uuid TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  const exceptions = Array.from({ length: 100 }, (_, index) => ({
    ...allToolsRule("allow"),
    id: crypto.randomUUID(),
    tool: `tool_${index}`,
  }));
  const save = (owner: string, value: unknown) =>
    db.run("INSERT INTO user_preferences VALUES (?, ?)", [
      owner,
      JSON.stringify(value),
    ]);
  const read = (owner: string) => {
    const row = db
      .query("SELECT value FROM user_preferences WHERE owner_uuid = ?")
      .get(owner) as { value: string };
    return JSON.parse(row.value) as Record<string, unknown>;
  };
  try {
    save("ask", {
      settings: { name: "Nick" },
      toolPermissions: { defaultAction: "ask", rules: exceptions },
    });
    save("allow", {
      toolPermissions: { defaultAction: "allow", rules: [exceptions[0]] },
    });
    save("none", { settings: { name: "Other" } });
    migrateToolPermissionDefaults(db);
    const migrated = read("ask");
    expect(migrated.settings).toEqual({ name: "Nick" });
    const policy = ToolPermissionsSchema.parse(migrated.toolPermissions);
    expect(policy.rules).toHaveLength(101);
    expect(policy.rules[0]).toMatchObject({
      tool: "*",
      action: "ask",
      condition: { kind: "any" },
    });
    expect(policy.rules.slice(1)).toEqual(exceptions);
    const permissions = permissionService.resolve(
      undefined,
      capabilitiesSchema.parse({}),
      policy,
    );
    expect(
      permissionService.callDecision(permissions, "tool_0", {}).action,
    ).toBe("allow");
    expect(
      permissionService.callDecision(permissions, "new_tool", {}).action,
    ).toBe("ask");
    expect(read("allow")).toEqual({
      toolPermissions: { rules: [exceptions[0]] },
    });
    expect(read("none")).toEqual({ settings: { name: "Other" } });
    migrateToolPermissionDefaults(db);
    expect(read("ask")).toEqual(migrated);
    db.run("UPDATE user_preferences SET value = ? WHERE owner_uuid = 'ask'", [
      JSON.stringify({ toolPermissions: { rules: exceptions } }),
    ]);
    migrateToolPermissionDefaults(db);
    expect(
      ToolPermissionsSchema.parse(read("ask").toolPermissions).rules,
    ).toEqual(exceptions);
  } finally {
    db.close();
  }
});

test("invalid stored permission data rolls back the entire migration", () => {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE user_preferences (owner_uuid TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  try {
    const original = JSON.stringify({
      toolPermissions: { defaultAction: "ask", rules: [] },
    });
    db.run("INSERT INTO user_preferences VALUES ('first', ?), ('second', ?)", [
      original,
      JSON.stringify({ toolPermissions: { defaultAction: "invalid" } }),
    ]);
    expect(() => migrateToolPermissionDefaults(db)).toThrow();
    expect(
      db
        .query("SELECT value FROM user_preferences WHERE owner_uuid = 'first'")
        .get(),
    ).toEqual({ value: original });
  } finally {
    db.close();
  }
});
