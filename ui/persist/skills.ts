import type { Skill } from "../../src/gen/euler/v1/skills_pb";
import type { SkillWriteBody } from "../../src/schemas/skills";
import { skillClient, withErrorMessage } from "../lib/rpc";

export type { Skill, SkillWriteBody };

const fields = (body: SkillWriteBody) => ({
  name: body.name,
  description: body.description,
  instructions: body.instructions,
  userInvocable: body.user_invocable,
  disableModelInvocation: body.disable_model_invocation,
});

export async function fetchSkills(): Promise<Skill[]> {
  return (
    await withErrorMessage(skillClient.listSkills({}), "Failed to fetch skills")
  ).skills;
}

export async function createSkillApi(body: SkillWriteBody): Promise<Skill> {
  return (
    await withErrorMessage(
      skillClient.createSkill({ skill: fields(body) }),
      "Failed to create skill",
    )
  ).skill!;
}

export async function updateSkillApi(
  id: string,
  body: SkillWriteBody,
): Promise<Skill> {
  return (
    await withErrorMessage(
      skillClient.updateSkill({ id, skill: fields(body) }),
      "Failed to update skill",
    )
  ).skill!;
}

export async function deleteSkillApi(id: string): Promise<void> {
  await withErrorMessage(
    skillClient.deleteSkill({ id }),
    "Failed to delete skill",
  );
}
