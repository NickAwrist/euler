import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrateToolPermissions } from "../../src/db/toolPermissionMigration";
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
    migrateToolPermissions(db);
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
    migrateToolPermissions(db);
    expect(read("ask")).toEqual(migrated);
    db.run("UPDATE user_preferences SET value = ? WHERE owner_uuid = 'ask'", [
      JSON.stringify({ toolPermissions: { rules: exceptions } }),
    ]);
    migrateToolPermissions(db);
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
    expect(() => migrateToolPermissions(db)).toThrow();
    expect(
      db
        .query("SELECT value FROM user_preferences WHERE owner_uuid = 'first'")
        .get(),
    ).toEqual({ value: original });
  } finally {
    db.close();
  }
});

test("stored prefixes become literal anchored regexes once, preserving scope and policy", () => {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE user_preferences (owner_uuid TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  const literal = "npm publish [tag].+$\\";
  const allow = { ...allToolsRule("allow"), tool: "other" };
  const original = {
    settings: { name: "Nick" },
    toolPermissions: {
      rules: [
        {
          ...allToolsRule("deny"),
          tool: "bash",
          sessionId: "chat",
          workspacePath: "/project",
          condition: {
            kind: "argument",
            field: "command",
            match: "prefix",
            value: literal,
          },
        },
        allow,
      ],
    },
  };
  const read = () => {
    const row = db
      .query("SELECT value FROM user_preferences WHERE owner_uuid='owner'")
      .get() as { value: string };
    return JSON.parse(row.value) as Record<string, unknown>;
  };
  try {
    db.run("INSERT INTO user_preferences VALUES ('owner', ?)", [
      JSON.stringify(original),
    ]);
    migrateToolPermissions(db);
    const migrated = read();
    expect(migrated.settings).toEqual(original.settings);
    const permissions = ToolPermissionsSchema.parse(migrated.toolPermissions);
    expect(permissions.rules).toHaveLength(2);
    expect(permissions.rules[0]).toMatchObject({
      id: original.toolPermissions.rules[0]!.id,
      action: "deny",
      sessionId: "chat",
      workspacePath: "/project",
      condition: { match: "regex" },
    });
    expect(permissions.rules[1]).toEqual(allow);
    const policy = permissionService.resolve(undefined, undefined, permissions);
    const scope = { sessionId: "chat", workspacePath: "/project" };
    for (const command of [literal, `${literal} --dry-run`])
      expect(
        permissionService.callDecision(policy, "bash", { command }, scope)
          .action,
      ).toBe("deny");
    for (const command of [`echo ${literal}`, "npm publish tagZZZ"])
      expect(
        permissionService.callDecision(policy, "bash", { command }, scope)
          .action,
      ).toBe("allow");
    migrateToolPermissions(db);
    expect(read()).toEqual(migrated);
  } finally {
    db.close();
  }
});

test("maximum length prefixes migrate without dropping a denial", () => {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE user_preferences (owner_uuid TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  try {
    db.run("INSERT INTO user_preferences VALUES ('owner', ?)", [
      JSON.stringify({
        toolPermissions: {
          defaultAction: "ask",
          rules: [
            {
              ...allToolsRule("deny"),
              condition: {
                kind: "argument",
                field: "command",
                match: "prefix",
                value: ".".repeat(10000),
              },
            },
          ],
        },
      }),
    ]);
    migrateToolPermissions(db);
    const row = db.query("SELECT value FROM user_preferences").get() as {
      value: string;
    };
    const permissions = ToolPermissionsSchema.parse(
      JSON.parse(row.value).toolPermissions,
    );
    expect(permissions.rules).toHaveLength(2);
    expect(permissions.rules[1]!.condition).toMatchObject({
      match: "regex",
      value: `^${"\\.".repeat(10000)}`,
    });
  } finally {
    db.close();
  }
});
