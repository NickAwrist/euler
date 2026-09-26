import { z } from "zod";
import {
  SkillWriteSchema,
  normalizeSkillName,
} from "../../../src/schemas/skills";
import type { SkillData, SkillWriteBody } from "../../persist/skills";

export type SkillEditorErrors = Partial<Record<keyof SkillWriteBody, string>>;

export function emptySkillEditor(): SkillWriteBody {
  return {
    name: "",
    description: "",
    instructions: "",
    user_invocable: true,
    disable_model_invocation: false,
  };
}

export function editorFromSkill(skill: SkillData): SkillWriteBody {
  return {
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    user_invocable: skill.user_invocable,
    disable_model_invocation: skill.disable_model_invocation,
  };
}

export function skillEditorsEqual(
  a: SkillWriteBody,
  b: SkillWriteBody,
): boolean {
  return (Object.keys(a) as Array<keyof SkillWriteBody>).every(
    (key) => a[key] === b[key],
  );
}

/** First schema error per field, or null when the editor is valid. */
export function skillEditorErrors(
  editor: SkillWriteBody,
): SkillEditorErrors | null {
  const parsed = SkillWriteSchema.safeParse(editor);
  if (parsed.success) return null;
  const { fieldErrors } = z.flattenError(parsed.error);
  return {
    name: fieldErrors.name?.[0],
    description: fieldErrors.description?.[0],
    instructions: fieldErrors.instructions?.[0],
  };
}

const FRONTMATTER_PATTERN =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

/**
 * Reads a pasted SKILL.md into editor fields. Frontmatter supports the flat
 * `key: value` form used by skills, including indented continuation lines.
 * Text without frontmatter becomes the instructions.
 */
export function parseSkillMarkdown(markdown: string): SkillWriteBody {
  const [, frontmatter = "", body = markdown] =
    markdown.match(FRONTMATTER_PATTERN) ?? [];
  const fields: Record<string, string> = {};
  let key = "";
  for (const line of frontmatter.split(/\r?\n/)) {
    const [, entryKey, value = ""] = line.match(/^([\w-]+):[ \t]*(.*)$/) ?? [];
    if (entryKey) {
      key = entryKey;
      // Block scalar indicators (| or >) start an indented value.
      fields[key] = /^[|>][+-]?$/.test(value)
        ? ""
        : value.trim().replace(/^(["'])(.*)\1$/, "$2");
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  return {
    name: normalizeSkillName(fields.name ?? "").replace(/-+$/, ""),
    description: fields.description ?? "",
    instructions: body.trim(),
    user_invocable: fields["user-invocable"] !== "false",
    disable_model_invocation: fields["disable-model-invocation"] === "true",
  };
}
