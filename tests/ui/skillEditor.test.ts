import { describe, expect, test } from "bun:test";
import { normalizeSkillName } from "../../src/schemas/skills";
import { skillEditorErrors } from "../../ui/components/CustomizationPage/skillsPageUtils";

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
      }),
    ).toBeNull();
  });
});
