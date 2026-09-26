import { describe, expect, test } from "bun:test";
import { normalizeSkillName } from "../../src/schemas/skills";
import {
  parseSkillMarkdown,
  skillEditorErrors,
} from "../../ui/components/CustomizationPage/skillsPageUtils";

describe("skill editor", () => {
  test("normalizes typed names toward the skill name pattern", () => {
    expect(normalizeSkillName("Release Notes!")).toBe("release-notes");
    expect(normalizeSkillName("  my__skill -- v2")).toBe("my-skill-v2");
    expect(normalizeSkillName("release ")).toBe("release-");
    expect(normalizeSkillName("!!!")).toBe("");
  });

  test("reports schema errors per field", () => {
    expect(
      skillEditorErrors({
        name: "release-",
        description: "  ",
        instructions: "Write notes",
        user_invocable: true,
        disable_model_invocation: false,
      }),
    ).toEqual({
      name: "name must use lowercase letters, numbers, and single hyphens only",
      description: "description is required",
    });
    expect(
      skillEditorErrors({
        name: "release-notes",
        description: "Draft release notes",
        instructions: "Write notes",
        user_invocable: true,
        disable_model_invocation: false,
      }),
    ).toBeNull();
  });

  test("parses a pasted SKILL.md into editor fields", () => {
    expect(
      parseSkillMarkdown(`---
name: Release Notes
description: >
  Draft release notes
  from merged changes.
user-invocable: false
disable-model-invocation: "true"
allowed-tools: Read
---

# Workflow
Group changes by impact.
`),
    ).toEqual({
      name: "release-notes",
      description: "Draft release notes from merged changes.",
      instructions: "# Workflow\nGroup changes by impact.",
      user_invocable: false,
      disable_model_invocation: true,
    });
    expect(parseSkillMarkdown("  Just instructions\n")).toEqual({
      name: "",
      description: "",
      instructions: "Just instructions",
      user_invocable: true,
      disable_model_invocation: false,
    });
  });
});
