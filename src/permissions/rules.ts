import type { ToolPermissionRule } from "../schemas/toolPermissions";

/** JSON object key order must not change whether an approved call matches. */
function sameArguments(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameArguments(value, right[index]))
    );
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameArguments(a[key], b[key]))
  );
}

export type PermissionScope = { sessionId?: string; workspacePath?: string };
export function matchesRule(
  rule: ToolPermissionRule,
  tool: string,
  args: Record<string, unknown>,
  scope: PermissionScope,
): boolean {
  if (
    (rule.tool !== "*" && rule.tool !== tool) ||
    (rule.sessionId !== undefined && rule.sessionId !== scope.sessionId) ||
    (rule.workspacePath !== undefined &&
      rule.workspacePath !== scope.workspacePath)
  )
    return false;
  const condition = rule.condition;
  if (condition.kind === "any") return true;
  if (condition.kind === "arguments")
    return sameArguments(condition.value, args);
  let value: unknown = args;
  for (const field of condition.field.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, field))
      return false;
    value = (value as Record<string, unknown>)[field];
  }
  return (
    typeof value === "string" &&
    (condition.match === "exact"
      ? value === condition.value
      : value.startsWith(condition.value))
  );
}

export function ruleSpecificity(rule: ToolPermissionRule): number {
  return (
    (rule.sessionId ? 16 : 0) +
    (rule.workspacePath ? 8 : 0) +
    (rule.tool === "*" ? 0 : 4) +
    (rule.condition.kind === "arguments"
      ? 3
      : rule.condition.kind === "argument"
        ? rule.condition.match === "exact"
          ? 2
          : 1
        : 0)
  );
}
