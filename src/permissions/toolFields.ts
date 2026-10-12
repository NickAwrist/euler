import { z } from "zod";
import {
  type ToolPermissionField,
  ToolPermissionValueSchema,
} from "../schemas/toolPermissions";
import { mergeToolFields } from "./toolFieldMetadata";

const ObjectSchema = z.record(z.string(), z.unknown());
function object(value: unknown): Record<string, unknown> | undefined {
  const parsed = ObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Scalar paths from the actual argument schema. Recursive definitions stop at their first cycle. */
export function toolFields(schema: unknown): ToolPermissionField[] {
  const root = object(schema);
  if (!root) return [];
  let visited = 0;
  let emitted = 0;
  const reference = (ref: string): unknown => {
    if (ref === "#") return root;
    if (!ref.startsWith("#/")) return undefined;
    let value: unknown = root;
    try {
      for (const token of decodeURIComponent(ref.slice(2)).split("/")) {
        const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
        const node = object(value);
        if (!node || !Object.hasOwn(node, key)) return undefined;
        value = node[key];
      }
      return value;
    } catch {
      return undefined;
    }
  };
  const visit = (
    input: unknown,
    path: string,
    depth: number,
    active: ReadonlySet<string>,
    fallback?: string,
  ): ToolPermissionField[] => {
    // Both bounds apply to the entire tool, not separately to recursive branches.
    if (++visited > 2000 || emitted >= 512 || depth > 32 || path.length > 200)
      return [];
    const node = object(input);
    if (!node) return [];
    const description =
      typeof node.description === "string" ? node.description : fallback;
    const groups: ToolPermissionField[][] = [];
    if (typeof node.$ref === "string" && !active.has(node.$ref)) {
      groups.push(
        visit(
          reference(node.$ref),
          path,
          depth + 1,
          new Set([...active, node.$ref]),
          description,
        ),
      );
    }
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const variants = node[keyword];
      if (Array.isArray(variants)) {
        const fields = variants.flatMap((variant) =>
          visit(variant, path, depth + 1, active, description),
        );
        groups.push(
          mergeToolFields(
            fields,
            keyword === "allOf" ? "intersection" : "union",
          ),
        );
      }
    }
    const properties = object(node.properties);
    if (properties) {
      groups.push(
        Object.entries(properties).flatMap(([name, child]) =>
          name && !name.includes(".")
            ? visit(child, path ? `${path}.${name}` : name, depth + 1, active)
            : [],
        ),
      );
    }
    const values = Array.isArray(node.enum)
      ? node.enum
      : Object.hasOwn(node, "const")
        ? [node.const]
        : undefined;
    const declared = Array.isArray(node.type) ? node.type : [node.type];
    const types = new Set(
      declared[0] === undefined
        ? values?.map((value) => typeof value)
        : declared.map((type) => (type === "integer" ? "number" : type)),
    );
    if (path)
      for (const type of types) {
        if (emitted >= 512) break;
        if (type !== "string" && type !== "number" && type !== "boolean")
          continue;
        const choices = values?.flatMap((value) => {
          const parsed = ToolPermissionValueSchema.safeParse(value);
          return parsed.success &&
            ((type === "string" && typeof parsed.data === "string") ||
              (type === "number" && typeof parsed.data === "number") ||
              (type === "boolean" && typeof parsed.data === "boolean"))
            ? [parsed.data]
            : [];
        });
        emitted++;
        groups.push([
          {
            path,
            type,
            ...(description ? { description } : {}),
            ...(choices !== undefined ? { values: choices } : {}),
          },
        ]);
      }
    return mergeToolFields(groups.flat(), "intersection")
      .filter(
        (field) =>
          field.path !== path ||
          declared[0] === undefined ||
          types.has(field.type),
      )
      .map((field) =>
        field.path === path && description ? { ...field, description } : field,
      );
  };
  return visit(root, "", 0, new Set()).filter(
    (field) => field.values?.length !== 0,
  );
}
