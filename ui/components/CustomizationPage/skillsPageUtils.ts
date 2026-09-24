import type { SkillData, SkillWriteBody } from "../../persist/skills";

export function emptySkillEditor(): SkillWriteBody {
  return { name: "", description: "", instructions: "" };
}

export function editorFromSkill(skill: SkillData): SkillWriteBody {
  return {
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
  };
}

export function skillEditorsEqual(
  a: SkillWriteBody,
  b: SkillWriteBody,
): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.instructions === b.instructions
  );
}
