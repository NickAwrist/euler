import { linkedWorkspace } from "../lib/workspace";
import type { Feature } from "../persist/features";
import type { SessionWorkspace } from "../types";

/** The commands this app can run. A feature's command with another name is not offered. */
const RUN_COMMAND_NAMES = [
  "directory",
  "link",
  "sandbox",
  "workspace",
] as const;
export type RunCommandName = (typeof RUN_COMMAND_NAMES)[number];

export type RunCommand = {
  name: RunCommandName;
  description: string;
};

/** The commands the given features add, each once, in the features' order. */
export function featureRunCommands(features: readonly Feature[]): RunCommand[] {
  const commands = new Map<RunCommandName, RunCommand>();
  for (const { name, description } of features.flatMap(
    (feature) => feature.commands,
  )) {
    const known = RUN_COMMAND_NAMES.find((candidate) => candidate === name);
    if (known && !commands.has(known))
      commands.set(known, { name: known, description });
  }
  return [...commands.values()];
}

export function matchingRunCommands(
  commands: readonly RunCommand[],
  input: string,
  workspace: SessionWorkspace,
): readonly RunCommand[] {
  const trimmed = input.trimStart();
  if (
    !trimmed.startsWith("/") ||
    trimmed.includes(" ") ||
    trimmed.includes("\n")
  ) {
    return [];
  }
  const query = trimmed.slice(1).toLowerCase();
  const privateSandbox =
    workspace.kind.case === "sandbox" && !linkedWorkspace(workspace);
  return commands.filter(
    (command) =>
      command.name.startsWith(query) &&
      (command.name !== "sandbox" || !privateSandbox),
  );
}

export function exactRunCommand(
  commands: readonly RunCommand[],
  input: string,
): RunCommandName | null {
  const value = input.trim();
  const command = commands.find((item) => `/${item.name}` === value);
  return command?.name ?? null;
}
