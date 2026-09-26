import type { SkillRow } from "../db/index";

const SKILL_REFERENCE_PATTERN = /\$([a-z0-9]+(?:-[a-z0-9]+)*)\b/g;

export function findExplicitSkillNames(message: string): Set<string> {
  return new Set(
    Array.from(message.matchAll(SKILL_REFERENCE_PATTERN)).flatMap((match) =>
      match[1] ? [match[1]] : [],
    ),
  );
}

/** Skills the agent may discover and load without an explicit $skill-name. */
export function modelInvocableSkills(skills: SkillRow[]): SkillRow[] {
  return skills.filter((skill) => !skill.disable_model_invocation);
}

export function renderSkillsPrompt(
  skills: SkillRow[],
  userMessage: string,
): string {
  const explicitNames = findExplicitSkillNames(userMessage);
  const activeSkills = skills
    .filter((skill) => skill.user_invocable && explicitNames.has(skill.name))
    .map((skill) => ({
      name: skill.name,
      instructions: skill.instructions,
    }));
  const metadata = modelInvocableSkills(skills).map((skill) => ({
    name: skill.name,
    description: skill.description,
  }));
  if (metadata.length === 0 && activeSkills.length === 0) return "";

  const lines = [
    "<skills>",
    "Skills are user-authored instructions for specialized tasks.",
    "Only skill metadata is listed in <available_skills>. When a task clearly matches a skill, call load_skill with its exact name before doing the task.",
    "A user can invoke a skill with $skill-name. Invoked skills appear in <active_skills>; follow those instructions without calling load_skill again.",
    "<available_skills>",
    JSON.stringify(metadata),
    "</available_skills>",
  ];

  if (activeSkills.length > 0) {
    lines.push(
      "<active_skills>",
      JSON.stringify(activeSkills),
      "</active_skills>",
    );
  }

  lines.push("</skills>");
  return lines.join("\n");
}
