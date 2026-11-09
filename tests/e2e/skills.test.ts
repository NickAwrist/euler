import "../setup";
import { expect, test } from "bun:test";
import { MANAGE_SUBAGENTS_SKILL_NAME } from "../../src/skills/defaults";
import { Code, rpc, rpcCode, rpcError } from "../helpers/rpc";

const fields = {
  name: "release-notes",
  description: "Draft release notes from merged changes.",
  instructions: "Group changes by user impact.",
  userInvocable: true,
  disableModelInvocation: false,
};

test("skills CRUD is validated and scoped to the current user", async () => {
  const { skills } = rpc();
  const other = rpc("22222222-2222-4222-8222-222222222222").skills;
  for (const [skill, message] of [
    [
      { ...fields, name: "Bad Skill" },
      "name must use lowercase letters, numbers, and single hyphens only",
    ],
    [{ ...fields, name: " " }, "name is required"],
    [
      { ...fields, name: "a".repeat(65) },
      "name must be 64 characters or fewer",
    ],
    [{ ...fields, description: "" }, "description is required"],
    [
      { ...fields, description: "a".repeat(501) },
      "description must be 500 characters or fewer",
    ],
    [{ ...fields, instructions: "\n" }, "instructions are required"],
  ] as const) {
    const error = await rpcError(skills.createSkill({ skill }));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(message);
  }

  const { skill } = await skills.createSkill({
    skill: { ...fields, name: " release-notes " },
  });
  expect(skill).toMatchObject({
    name: "release-notes",
    userInvocable: true,
    disableModelInvocation: false,
  });
  expect(await rpcCode(skills.createSkill({ skill: fields }))).toBe(
    Code.FailedPrecondition,
  );

  expect((await skills.listSkills({})).skills).toMatchObject([
    { name: MANAGE_SUBAGENTS_SKILL_NAME },
    { id: skill!.id, name: "release-notes" },
  ]);
  expect((await other.listSkills({})).skills).toMatchObject([
    { name: MANAGE_SUBAGENTS_SKILL_NAME },
  ]);

  const updated = await skills.updateSkill({
    id: skill!.id,
    skill: {
      ...fields,
      description: "Draft concise release notes.",
      instructions: "Lead with user-visible changes.",
      disableModelInvocation: true,
    },
  });
  expect(updated.skill).toMatchObject({
    id: skill!.id,
    instructions: "Lead with user-visible changes.",
    userInvocable: true,
    disableModelInvocation: true,
  });
  expect((await skills.getSkill({ id: skill!.id })).skill?.description).toBe(
    "Draft concise release notes.",
  );

  expect(await rpcCode(other.deleteSkill({ id: skill!.id }))).toBe(
    Code.NotFound,
  );
  expect(await rpcCode(other.getSkill({ id: skill!.id }))).toBe(Code.NotFound);
  await skills.deleteSkill({ id: skill!.id });
  expect(await rpcCode(skills.getSkill({ id: skill!.id }))).toBe(Code.NotFound);
});
