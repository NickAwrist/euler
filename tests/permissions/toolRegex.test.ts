import { expect, spyOn, test } from "bun:test";
import { RE2JS } from "re2js";
import { permissionService } from "../../src/permissions/PermissionService";
import { compileToolRegex } from "../../src/permissions/toolRegex";
import { ToolPermissionsSchema } from "../../src/schemas/toolPermissions";

test("validation and repeated tool decisions reuse one compiled pattern", () => {
  const pattern = `^${crypto.randomUUID()}$`;
  const compile = spyOn(RE2JS, "compile");
  try {
    const policy = {
      rules: [
        {
          id: crypto.randomUUID(),
          tool: "bash",
          action: "deny",
          condition: {
            kind: "argument",
            field: "command",
            match: "regex",
            value: pattern,
          },
        },
      ],
    };
    const permissions = permissionService.resolve(
      undefined,
      undefined,
      ToolPermissionsSchema.parse(policy),
    );
    ToolPermissionsSchema.parse(policy);
    for (let repeat = 0; repeat < 10; repeat++)
      expect(
        permissionService.callDecision(permissions, "bash", {
          command: "unrelated",
        }).action,
      ).toBe("allow");
    expect(compile).toHaveBeenCalledTimes(1);
  } finally {
    compile.mockRestore();
  }
});

test("changing patterns evicts old entries while retaining recently used patterns", () => {
  const first = crypto.randomUUID();
  const original = compileToolRegex(first);
  const recent = crypto.randomUUID();
  const retained = compileToolRegex(recent);
  for (let edit = 0; edit < 500; edit++) {
    compileToolRegex(`^edit${edit}$`);
    expect(compileToolRegex(recent)).toBe(retained);
  }
  expect(compileToolRegex(first)).not.toBe(original);
});
