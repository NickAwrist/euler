import { BookOpen, Command, type LucideIcon, Plug } from "lucide-react";
import type { DisplayIcon } from "../../src/schemas/icons";
import type { McpToolData } from "../../src/schemas/mcp";
import type { SkillData } from "../persist/skills";
import type { SessionWorkspace } from "../types";
import { type RunCommandName, matchingRunCommands } from "./runCommands";
import { type ActiveSkillToken, completeSkillToken } from "./skillPicker";

/** Sources own matching and selection; the picker only renders and navigates. */
export interface ComposerSuggestion {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  icons?: readonly DisplayIcon[];
  select: () => void;
}

export interface ComposerSuggestionContext {
  input: string;
  workspace: SessionWorkspace;
  busy: boolean;
  skills: readonly SkillData[];
  tools: readonly McpToolData[];
  skillToken: ActiveSkillToken | null;
  toolToken: ReturnType<typeof findActiveToolToken>;
  complete: (completion: { value: string; caret: number }) => void;
  runCommand: (command: RunCommandName) => void;
}

export interface ComposerSuggestionSource {
  getSuggestions: (
    context: ComposerSuggestionContext,
  ) => readonly ComposerSuggestion[];
}

export const composerSuggestionSources: readonly ComposerSuggestionSource[] = [
  {
    getSuggestions: ({ input, workspace, busy, runCommand }) =>
      busy
        ? []
        : matchingRunCommands(input, workspace).map((command) => ({
            id: `command:${command.name}`,
            label: `/${command.name}`,
            description: command.description,
            icon: Command,
            select: () => runCommand(command.name),
          })),
  },
  {
    getSuggestions: ({ input, skills, skillToken, complete }) =>
      skillToken
        ? skills
            .filter(
              (skill) =>
                skill.user_invocable && skill.name.startsWith(skillToken.query),
            )
            .slice(0, 8)
            .map((skill) => ({
              id: `skill:${skill.id}`,
              label: `$${skill.name}`,
              description: skill.description,
              icon: BookOpen,
              select: () =>
                complete(completeSkillToken(input, skillToken, skill.name)),
            }))
        : [],
  },
  {
    getSuggestions: ({ input, tools, toolToken, complete }) =>
      toolToken
        ? tools
            .filter((tool) =>
              tool.name.toLowerCase().includes(toolToken.query.toLowerCase()),
            )
            .slice(0, 8)
            .map((tool) => ({
              id: `mcp:${tool.name}`,
              label: `/${tool.name}`,
              description: tool.description,
              icon: Plug,
              icons: tool.icons,
              select: () =>
                complete(completeToolToken(input, toolToken, tool.name)),
            }))
        : [],
  },
];

export function collectComposerSuggestions(
  sources: readonly ComposerSuggestionSource[],
  context: ComposerSuggestionContext,
): ComposerSuggestion[] {
  return sources.flatMap((source) => source.getSuggestions(context));
}

export function findActiveToolToken(value: string, caret: number) {
  if (caret < 0 || caret > value.length) return null;
  const start = value.lastIndexOf("/", caret - 1);
  if (start < 0 || start >= caret) return null;
  if (start > 0 && !/\s/.test(value[start - 1]!)) return null;
  const query = value.slice(start + 1, caret);
  if (!/^[A-Za-z0-9_-]*$/.test(query)) return null;
  const suffix = value.slice(caret).match(/^[A-Za-z0-9_-]*/)?.[0] ?? "";
  return { start, end: caret + suffix.length, query };
}

export function completeToolToken(
  value: string,
  token: { start: number; end: number },
  name: string,
) {
  const replacement = `/${name}${token.end === value.length ? " " : ""}`;
  return {
    value: `${value.slice(0, token.start)}${replacement}${value.slice(token.end)}`,
    caret: token.start + replacement.length,
  };
}
