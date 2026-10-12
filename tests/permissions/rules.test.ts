import { expect, test } from "bun:test";
import { permissionService } from "../../src/permissions/PermissionService";
import {
  type ToolPermissionRule,
  ToolPermissionsSchema,
} from "../../src/schemas/toolPermissions";
import { capabilitiesSchema } from "../../src/schemas/userPreferences";

const rule = (
  action: ToolPermissionRule["action"],
  condition: ToolPermissionRule["condition"],
): ToolPermissionRule => ({
  id: crypto.randomUUID(),
  tool: "bash",
  action,
  condition,
});
const evaluate = (rules: ToolPermissionRule[], command: string) =>
  permissionService.callDecision(
    permissionService.resolve({ kind: "local" }, capabilitiesSchema.parse({}), {
      defaultAction: "ask",
      rules,
    }),
    "bash",
    { command },
    { sessionId: "chat", workspacePath: "/project" },
  );
test("deny wins over allows; specific allows override a general ask, otherwise ask is the default", () => {
  const ask = rule("ask", { kind: "any" });
  const allow = rule("allow", {
    kind: "argument",
    field: "command",
    match: "exact",
    value: "bun run build",
  });
  const deny = rule("deny", {
    kind: "argument",
    field: "command",
    match: "prefix",
    value: "npm publish",
  });
  expect(evaluate([allow, ask], "bun run build").action).toBe("allow");
  expect(
    evaluate([rule("allow", { kind: "any" }), deny], "npm publish --dry-run")
      .action,
  ).toBe("deny");
  expect(evaluate([allow], "npm publish").action).toBe("ask");
  expect(
    evaluate([allow, rule("ask", allow.condition)], "bun run build").action,
  ).toBe("ask");
});
test("matching calls bind all arguments and their chat/workspace; object key order is irrelevant", () => {
  const allow = {
    ...rule("allow", {
      kind: "arguments",
      value: {
        command: "npm publish",
        background: false,
        options: { first: 1, second: true },
      },
    }),
    sessionId: "chat",
    workspacePath: "/project",
  };
  const policy = permissionService.resolve(
    undefined,
    capabilitiesSchema.parse({}),
    { defaultAction: "ask", rules: [allow] },
  );
  const args = {
    options: { second: true, first: 1 },
    background: false,
    command: "npm publish",
  };
  const call = (
    callArgs: Record<string, unknown>,
    sessionId = "chat",
    workspacePath = "/project",
  ) =>
    permissionService.callDecision(policy, "bash", callArgs, {
      sessionId,
      workspacePath,
    }).action;
  expect(call(args)).toBe("allow");
  expect(call({ ...args, background: true })).toBe("ask");
  expect(call(args, "another-chat")).toBe("ask");
  expect(call(args, "chat", "/another-project")).toBe("ask");
  expect(call({ command: "npm publish" })).toBe("ask");
});
test("argument rules read only own fields, and capability denials cannot be approved away", () => {
  const allow = rule("allow", {
    kind: "argument",
    field: "options.command",
    match: "exact",
    value: "build",
  });
  const policy = permissionService.resolve(
    undefined,
    capabilitiesSchema.parse({}),
    { defaultAction: "ask", rules: [allow] },
  );
  expect(
    permissionService.callDecision(policy, "bash", {
      options: { command: "build" },
    }).action,
  ).toBe("allow");
  expect(
    permissionService.callDecision(policy, "bash", {
      options: Object.create({ command: "build" }),
    }).action,
  ).toBe("ask");
  const disabled = permissionService.resolve(
    undefined,
    capabilitiesSchema.parse({ shell: false }),
    { defaultAction: "allow", rules: [rule("allow", { kind: "any" })] },
  );
  expect(permissionService.callDecision(disabled, "bash", {}).action).toBe(
    "deny",
  );
  expect(ToolPermissionsSchema.parse({}).defaultAction).toBe("allow");
});
