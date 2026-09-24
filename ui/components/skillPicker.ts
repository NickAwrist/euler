export type ActiveSkillToken = {
  start: number;
  end: number;
  query: string;
};

export function findActiveSkillToken(
  value: string,
  caret: number,
): ActiveSkillToken | null {
  if (caret < 0 || caret > value.length) return null;
  const beforeCaret = value.slice(0, caret);
  const start = beforeCaret.lastIndexOf("$");
  if (start < 0) return null;

  const leadingCharacter = value[start - 1];
  if (leadingCharacter && /[a-zA-Z0-9_-]/.test(leadingCharacter)) return null;

  const query = value.slice(start + 1, caret);
  if (!/^[a-z0-9-]*$/.test(query)) return null;

  const suffix = value.slice(caret).match(/^[a-z0-9-]*/)?.[0] ?? "";
  return { start, end: caret + suffix.length, query };
}

export function completeSkillToken(
  value: string,
  token: ActiveSkillToken,
  skillName: string,
): { value: string; caret: number } {
  const needsSpace = token.end === value.length;
  const replacement = `$${skillName}${needsSpace ? " " : ""}`;
  return {
    value: `${value.slice(0, token.start)}${replacement}${value.slice(token.end)}`,
    caret: token.start + replacement.length,
  };
}
