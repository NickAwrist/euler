import { describe, expect, test } from "bun:test";
import {
  conditionFits,
  ruleFields,
} from "../../ui/components/CustomizationPage/toolPermissionFields";

const tools = [
  {
    name: "bash",
    description: "Run a command",
    fields: [
      { path: "command", type: "string" as const, description: "Command" },
      { path: "background", type: "boolean" as const },
      { path: "mode", type: "string" as const, values: ["a", "b"] },
    ],
  },
  {
    name: "image",
    description: "Make an image",
    fields: [
      { path: "size.width", type: "number" as const },
      { path: "background", type: "string" as const },
      { path: "mode", type: "string" as const, values: ["b", "c"] },
      { path: "command", type: "string" as const, description: "Prompt" },
    ],
  },
  { name: "list", description: "List", fields: [] },
];

describe("tool permission fields", () => {
  test("lists the selected tool's fields", () => {
    expect(ruleFields(tools, "bash")).toBe(tools[0]!.fields);
    expect(ruleFields(tools, "list")).toEqual([]);
    expect(ruleFields(tools, "missing")).toEqual([]);
  });

  test("All tools merges fields once per path and type", () => {
    expect(ruleFields(tools, "*")).toEqual([
      { path: "background", type: "boolean" },
      { path: "background", type: "string" },
      // Descriptions that differ between tools are dropped.
      { path: "command", type: "string" },
      { path: "mode", type: "string", values: ["a", "b", "c"] },
      { path: "size.width", type: "number" },
    ]);
  });

  test("All tools only keeps a value list every tool restricts to", () => {
    const merged = ruleFields(
      [
        ...tools,
        {
          name: "other",
          description: "",
          fields: [{ path: "mode", type: "string" as const }],
        },
      ],
      "*",
    );
    expect(merged.find((field) => field.path === "mode")).toEqual({
      path: "mode",
      type: "string",
    });
  });

  test("conditions fit fields by type, value list, and match", () => {
    const [command, background, mode] = tools[0]!.fields;
    const condition = { kind: "argument" as const, field: "command" };
    expect(
      conditionFits(command!, { ...condition, match: "prefix", value: "git" }),
    ).toBe(true);
    expect(
      conditionFits(background!, {
        ...condition,
        field: "background",
        match: "exact",
        value: "true",
      }),
    ).toBe(false);
    expect(
      conditionFits(mode!, {
        ...condition,
        field: "mode",
        match: "exact",
        value: "c",
      }),
    ).toBe(false);
    expect(
      conditionFits(mode!, {
        ...condition,
        field: "mode",
        match: "prefix",
        value: "a",
      }),
    ).toBe(false);
  });
});
