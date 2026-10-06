import type { SessionWorkspace } from "../types";

export type RunCommandName = "directory" | "link" | "sandbox" | "workspace";

export type RunCommand = {
  name: RunCommandName;
  description: string;
};

export const RUN_COMMANDS: readonly RunCommand[] = [
  {
    name: "directory",
    description: "Allow this chat to work in a folder on the server",
  },
  { name: "link", description: "Work in another chat's workspace" },
  { name: "sandbox", description: "Return this chat to its private workspace" },
  { name: "workspace", description: "Show files in this chat's workspace" },
];

export function matchingRunCommands(
  input: string,
  workspace: SessionWorkspace,
  temporary: boolean,
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
  const privateSandbox = workspace.kind === "sandbox" && !workspace.linked;
  return RUN_COMMANDS.filter(
    (command) =>
      command.name.startsWith(query) &&
      (command.name !== "sandbox" || !privateSandbox) &&
      // Temporary chats are discarded with their workspace, so they never link.
      (command.name !== "link" || !temporary),
  );
}

export function exactRunCommand(input: string): RunCommandName | null {
  const value = input.trim();
  const command = RUN_COMMANDS.find((item) => `/${item.name}` === value);
  return command?.name ?? null;
}
