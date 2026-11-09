import type { Skill } from "../../src/gen/euler/v1/skills_pb";
import type { SkillWriteBody } from "../../src/schemas/skills";
import { skillClient } from "../lib/rpc";

export type { Skill, SkillWriteBody };

const fields = (body: SkillWriteBody) => ({
  name: body.name,
  description: body.description,
  instructions: body.instructions,
  userInvocable: body.user_invocable,
  disableModelInvocation: body.disable_model_invocation,
});

export async function fetchSkills(): Promise<Skill[]> {
  return (await skillClient.listSkills({})).skills;
}

export async function createSkillApi(body: SkillWriteBody): Promise<Skill> {
  return (await skillClient.createSkill({ skill: fields(body) })).skill!;
}

export async function updateSkillApi(
  id: string,
  body: SkillWriteBody,
): Promise<Skill> {
  return (await skillClient.updateSkill({ id, skill: fields(body) })).skill!;
}

export async function deleteSkillApi(id: string): Promise<void> {
  await skillClient.deleteSkill({ id });
}
