import { SkillWriteSchema } from "../../../src/schemas/skills";
import type { SkillData, SkillWriteBody } from "../../persist/skills";

export type SkillEditorErrors = Partial<Record<keyof SkillWriteBody, string>>;

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

export function skillEditorErrors(editor: SkillWriteBody): SkillEditorErrors {
  const parsed = SkillWriteSchema.safeParse(editor);
  if (parsed.success) return {};
  const { fieldErrors } = parsed.error.flatten();
  return {
    name: fieldErrors.name?.[0],
    description: fieldErrors.description?.[0],
    instructions: fieldErrors.instructions?.[0],
  };
}
