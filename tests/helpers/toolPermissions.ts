import type { ToolPermissionRule } from "../../src/schemas/toolPermissions";

export function allToolsRule(
  action: ToolPermissionRule["action"] = "ask",
): ToolPermissionRule {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    tool: "*",
    action,
    condition: { kind: "any" },
  };
}
