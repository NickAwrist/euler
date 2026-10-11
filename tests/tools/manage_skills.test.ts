import "../setup";
import { describe, expect, test } from "bun:test";
import { createSkillRow, getSkillByName } from "../../src/db";
import { ManageSkillsTool } from "../../src/tools/manage_skills";

const OWNER = "66666666-6666-4666-8666-666666666666";
const OTHER_OWNER = "77777777-7777-4777-8777-777777777777";

describe("manage_skills", () => {
  const tool = new ManageSkillsTool(OWNER);

  test("updates only the given fields of a skill hidden from agents", async () => {
    createSkillRow(OWNER, {
      name: "storytelling",
      description: "Write short stories.",
      instructions: "Use three acts.",
      user_invocable: true,
      disable_model_invocation: true,
    });

    const result = await tool.execute({
      action: "update",
      name: "storytelling",
      new_name: "story-writer",
      instructions: "Open with dialogue.",
    });

    expect(JSON.parse(result.text)).toEqual({
      name: "story-writer",
      description: "Write short stories.",
      instructions: "Open with dialogue.",
      user_invocable: true,
      disable_model_invocation: true,
    });
    expect(getSkillByName(OWNER, "storytelling")).toBeNull();
  });

  test("rejects invalid and duplicate skills without saving", async () => {
    createSkillRow(OWNER, {
      name: "release-notes",
      description: "Draft release notes.",
      instructions: "Group by impact.",
      user_invocable: true,
      disable_model_invocation: false,
    });

    const invalid = await tool.execute({
      action: "create",
      name: "Bad Name",
      description: "x",
      instructions: "y",
    });
    expect(invalid.text).toContain("lowercase letters");
    expect(getSkillByName(OWNER, "Bad Name")).toBeNull();

    const duplicate = await tool.execute({
      action: "create",
      name: "release-notes",
      description: "Another.",
      instructions: "Other.",
    });
    expect(duplicate.text).toBe(
      "Error: a skill named 'release-notes' already exists",
    );
    expect(getSkillByName(OWNER, "release-notes")?.instructions).toBe(
      "Group by impact.",
    );
  });

  test("only reaches the owner's skills", async () => {
    createSkillRow(OTHER_OWNER, {
      name: "private-skill",
      description: "Private.",
      instructions: "Private instructions.",
      user_invocable: true,
      disable_model_invocation: false,
    });

    const result = await tool.execute({
      action: "delete",
      name: "private-skill",
    });

    expect(result.text).toStartWith("Error: skill 'private-skill' not found");
    expect(getSkillByName(OTHER_OWNER, "private-skill")).not.toBeNull();
  });
});
