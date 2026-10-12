import { mergeToolFields } from "../../../src/permissions/toolFieldMetadata";
import type {
  ToolPermissionField,
  ToolPermissionRule,
} from "../../../src/schemas/toolPermissions";
import type { ToolPermissionTool } from "../../persist/userPreferences";

export type FieldType = ToolPermissionField["type"];
export type ArgumentCondition = Extract<
  ToolPermissionRule["condition"],
  { kind: "argument" }
>;
type FieldValue = ArgumentCondition["value"];

/** Rule tool that matches every tool. */
export const ALL_TOOLS = "*";

export const valueType = (value: FieldValue): FieldType =>
  typeof value === "number"
    ? "number"
    : typeof value === "boolean"
      ? "boolean"
      : "string";

/**
 * Fields a rule for `tool` can match. All tools merges every tool's fields,
 * keeping a path once per type and a value list only if every tool has one.
 */
export function ruleFields(
  tools: ToolPermissionTool[],
  tool: string,
): ToolPermissionField[] {
  if (tool !== ALL_TOOLS)
    return tools.find((option) => option.name === tool)?.fields ?? [];
  return mergeToolFields(tools.flatMap((option) => option.fields));
}

/** Whether `condition` can match calls that set `field`. */
export function conditionFits(
  field: ToolPermissionField,
  condition: ArgumentCondition,
): boolean {
  if (condition.field !== field.path) return false;
  if (valueType(condition.value) !== field.type) return false;
  if (condition.match === "prefix" && (field.type !== "string" || field.values))
    return false;
  return !field.values || field.values.includes(condition.value);
}
