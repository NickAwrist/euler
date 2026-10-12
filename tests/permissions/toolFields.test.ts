import { expect, test } from "bun:test";
import { toolFields } from "../../src/permissions/toolFields";

test("tool fields come from the schema, including nested paths, nullable types, enums and constants", () => {
  expect(
    toolFields({
      type: "object",
      properties: {
        command: { type: "string", description: "Command" },
        background: { type: "boolean" },
        limit: { type: "integer" },
        action: { enum: ["read", "write"] },
        mode: { const: "safe" },
        options: {
          type: "object",
          properties: { cwd: { type: ["string", "null"] } },
        },
        items: { type: "array", items: { type: "string" } },
      },
    }),
  ).toEqual([
    { path: "action", type: "string", values: ["read", "write"] },
    { path: "background", type: "boolean" },
    { path: "command", type: "string", description: "Command" },
    { path: "limit", type: "number" },
    { path: "mode", type: "string", values: ["safe"] },
    { path: "options.cwd", type: "string" },
  ]);
});

test("local references and composed schemas expose their fields while cyclic or malformed refs stay bounded", () => {
  const schema = {
    $defs: {
      Options: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          enabled: { anyOf: [{ type: "null" }, { type: "boolean" }] },
        },
      },
    },
    properties: {
      options: { $ref: "#/$defs/Options" },
      mixed: { oneOf: [{ type: "string" }, { type: "number" }] },
      invalid: { $ref: "#/%NOT" },
      external: { $ref: "https://example.com/schema" },
      "literal.dot": { type: "string" },
    },
  };
  const fields = toolFields(schema);
  expect(fields).toContainEqual({ path: "options.cwd", type: "string" });
  expect(fields).toContainEqual({ path: "options.enabled", type: "boolean" });
  expect(
    fields.filter((field) => field.path === "mixed").map((field) => field.type),
  ).toEqual(["number", "string"]);
  expect(fields).toHaveLength(4);
  expect(
    toolFields({
      $defs: { cycle: { $ref: "#/$defs/cycle" } },
      properties: { field: { $ref: "#/$defs/cycle" } },
    }),
  ).toEqual([]);
  expect(toolFields(null)).toEqual([]);
});

test("branching recursive references terminate without expanding each descendant", () => {
  for (const branches of [2, 3]) {
    const properties = Object.fromEntries(
      Array.from({ length: branches }, (_, index) => [
        `child${index}`,
        { $ref: "#/$defs/tree" },
      ]),
    );
    const fields = toolFields({
      $defs: {
        tree: {
          properties: { value: { type: "string" }, ...properties },
        },
      },
      properties: { tree: { $ref: "#/$defs/tree" } },
    });
    expect(fields).toEqual([{ path: "tree.value", type: "string" }]);
  }
  expect(
    toolFields({
      properties: {
        value: { type: "string" },
        child: { $ref: "#" },
      },
    }),
  ).toEqual([
    { path: "child.value", type: "string" },
    { path: "value", type: "string" },
  ]);
});

test("variant choices union alternatives and intersect simultaneous constraints", () => {
  for (const variants of [
    [{ type: "string" }, { enum: ["x"] }],
    [{ enum: ["x"] }, { type: "string" }],
  ]) {
    expect(toolFields({ properties: { value: { anyOf: variants } } })).toEqual([
      { path: "value", type: "string" },
    ]);
  }
  expect(
    toolFields({
      properties: {
        union: { oneOf: [{ enum: ["x", "y"] }, { enum: ["y", "z"] }] },
        intersection: {
          allOf: [
            { type: "string" },
            { enum: ["x", "y"] },
            { enum: ["y", "z"] },
          ],
        },
        labeled: {
          description: "Choose an action",
          $ref: "#/$defs/action",
        },
      },
      $defs: { action: { enum: ["read", "write"] } },
    }),
  ).toEqual([
    { path: "intersection", type: "string", values: ["y"] },
    {
      path: "labeled",
      type: "string",
      description: "Choose an action",
      values: ["read", "write"],
    },
    { path: "union", type: "string", values: ["x", "y", "z"] },
  ]);
});

test("oversized schemas have a global field limit", () => {
  const fields = toolFields({
    properties: Object.fromEntries(
      Array.from({ length: 1000 }, (_, index) => [
        `field${index}`,
        { type: ["string", "number", "boolean"] },
      ]),
    ),
  });
  expect(fields).toHaveLength(512);
  expect(fields.every((field) => field.path.length <= 200)).toBe(true);
});

test("fields with no matchable choices are omitted from the picker", () => {
  expect(
    toolFields({
      properties: {
        empty: { type: "string", enum: [""] },
        tooLong: { const: "x".repeat(10001) },
        impossible: { allOf: [{ enum: ["x"] }, { enum: ["y"] }] },
        valid: { enum: ["", "x"] },
      },
    }),
  ).toEqual([{ path: "valid", type: "string", values: ["x"] }]);
});
