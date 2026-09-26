import { describe, expect, test } from "bun:test";
import type { SkillRow } from "../../src/db";
import {
  findExplicitSkillNames,
  renderSkillsPrompt,
} from "../../src/skills/runtime";

const skill: SkillRow = {
  id: "skill-1",
  owner_uuid: "user-1",
  name: "release-notes",
  description: "Draft release notes from a set of merged changes.",
  instructions: "Group changes by user impact and link each pull request.",
  user_invocable: true,
  disable_model_invocation: false,
  created_at: 1,
  updated_at: 1,
};

describe("skill runtime", () => {
  test("lists metadata without eagerly including instructions", () => {
    const prompt = renderSkillsPrompt([skill], "Summarize this patch");

    expect(prompt).toContain('"name":"release-notes"');
    expect(prompt).toContain(skill.description);
    expect(prompt).not.toContain(skill.instructions);
  });

  test("activates exact $skill-name references", () => {
    const prompt = renderSkillsPrompt(
      [skill],
      "Use $release-notes for this version.",
    );

    expect(findExplicitSkillNames("$release-notes, then $unknown")).toEqual(
      new Set(["release-notes", "unknown"]),
    );
    expect(prompt).toContain("<active_skills>");
    expect(prompt).toContain(skill.instructions);
  });

  test("hides user-only skills from agents but activates them when invoked", () => {
    const userOnly = { ...skill, disable_model_invocation: true };

    expect(renderSkillsPrompt([userOnly], "Summarize this patch")).toBe("");
    const invoked = renderSkillsPrompt([userOnly], "Use $release-notes.");
    expect(invoked).toContain("<available_skills>\n[]");
    expect(invoked).toContain(skill.instructions);
  });

  test("ignores $skill-name for skills users cannot invoke", () => {
    const prompt = renderSkillsPrompt(
      [{ ...skill, user_invocable: false }],
      "Use $release-notes.",
    );

    expect(prompt).toContain('"name":"release-notes"');
    expect(prompt).not.toContain(skill.instructions);
  });
});
