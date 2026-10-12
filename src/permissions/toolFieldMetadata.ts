import type { ToolPermissionField } from "../schemas/toolPermissions";

/** Merge alternative tool definitions, or intersect constraints from one schema. */
export function mergeToolFields(
  fields: readonly ToolPermissionField[],
  mode: "union" | "intersection" = "union",
): ToolPermissionField[] {
  const merged = new Map<string, ToolPermissionField>();
  for (const field of fields) {
    const key = `${field.type}:${field.path}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...field });
      continue;
    }
    const values =
      mode === "intersection"
        ? previous.values && field.values
          ? previous.values.filter((value) => field.values?.includes(value))
          : (previous.values ?? field.values)
        : previous.values && field.values
          ? [...new Set([...previous.values, ...field.values])]
          : undefined;
    merged.set(key, {
      path: field.path,
      type: field.type,
      ...(previous.description === field.description && {
        description: field.description,
      }),
      ...(values !== undefined && { values }),
    });
  }
  return [...merged.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type),
  );
}
