/**
 * Pure, browser-safe system-prompt renderer. Templates may contain `{{PERSONALIZATION}}`, `{{SESSION_DIRECTORY}}`, `{{OS}}` tokens;
 * missing values cause the token (and its surrounding blank line) to be
 * removed from the output.
 */

export type PersonalizationFields = {
  name?: string;
  location?: string;
  preferredFormats?: string;
  /** Optional date override; defaults to the current date at render time. */
  now?: Date;
  /** Whether to include the current date in the rendered block; defaults to true. */
  includeCurrentDate?: boolean;
};

export type PromptContext = {
  /** User's system prompt template; empty uses the default template. */
  systemPrompt?: string;
  personalization?: PersonalizationFields;
  sessionDirectory?: string;
  os?: string;
};

/**
 * Invariant suffix appended to every agent's final system prompt. These
 * directives must always be present regardless of the user-authored template.
 * Appended by BaseAgent after rendering the template and skills.
 */
export const CORE_DIRECTIVES = [
  "<tool_format>",
  "When calling tools, output strictly valid JSON arguments. Do not use custom delimiters or markup.",
  "For multi-line string arguments (file contents, code), escape newlines as \\n or use an array of strings via the `lines` property when available.",
  "</tool_format>",
  "",
  "<agency>",
  "You are an action-oriented agent. When you decide on a next step, immediately execute it with a tool call.",
  "Never end your turn with only a plan or commentary - always follow through with the corresponding tool call unless the task is fully complete.",
  "</agency>",
].join("\n");

export const PROMPT_PLACEHOLDERS = {
  PERSONALIZATION: "{{PERSONALIZATION}}",
  SESSION_DIRECTORY: "{{SESSION_DIRECTORY}}",
  OS: "{{OS}}",
} as const;

export type PromptPlaceholderKey = keyof typeof PROMPT_PLACEHOLDERS;

export const PROMPT_PLACEHOLDER_LIST: Array<{
  key: PromptPlaceholderKey;
  token: string;
  description: string;
}> = [
  {
    key: "PERSONALIZATION",
    token: PROMPT_PLACEHOLDERS.PERSONALIZATION,
    description: "User name, location, preferred response format, and date.",
  },
  {
    key: "SESSION_DIRECTORY",
    token: PROMPT_PLACEHOLDERS.SESSION_DIRECTORY,
    description: "Absolute working directory for this run session.",
  },
  {
    key: "OS",
    token: PROMPT_PLACEHOLDERS.OS,
    description: "Operating system of the server running the agent.",
  },
];

function formatPersonalizationBlock(fields: PersonalizationFields): string {
  const name = fields.name?.trim();
  const location = fields.location?.trim();
  const preferredFormats = fields.preferredFormats?.trim();
  const lines: string[] = [];
  if (name) lines.push(`User name: ${name}`);
  if (location) lines.push(`Location: ${location}`);
  if (preferredFormats)
    lines.push(`Preferred response format: ${preferredFormats}`);

  if (fields.includeCurrentDate !== false) {
    const now = fields.now ?? new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    lines.push(`Current date: ${dateStr}`);
  }

  if (lines.length === 0) return "";

  return ["--- User personalization ---", ...lines].join("\n");
}

function formatSessionDirectoryBlock(absResolvedPath: string): string {
  return `--- Session context ---\nSession directory: ${absResolvedPath}`;
}

function formatOsBlock(os: string): string {
  return `OS: ${os}`;
}

function resolveValue(key: PromptPlaceholderKey, ctx: PromptContext): string {
  switch (key) {
    case "PERSONALIZATION": {
      const p = ctx.personalization;
      if (!p) return "";
      return formatPersonalizationBlock(p);
    }
    case "SESSION_DIRECTORY": {
      const dir = ctx.sessionDirectory?.trim();
      return dir ? formatSessionDirectoryBlock(dir) : "";
    }
    case "OS": {
      const os = ctx.os?.trim();
      return os ? formatOsBlock(os) : "";
    }
  }
}

/**
 * Replace each `{{TOKEN}}` with its rendered block, or with an empty string
 * when the value is absent. Consecutive blank lines produced by removed
 * tokens are collapsed to a single blank line, and leading/trailing
 * whitespace is trimmed.
 */
export function renderSystemPrompt(
  template: string,
  ctx: PromptContext,
): string {
  let out = template;
  for (const { key, token } of PROMPT_PLACEHOLDER_LIST) {
    if (!out.includes(token)) continue;
    const value = resolveValue(key, ctx);
    out = out.split(token).join(value);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
