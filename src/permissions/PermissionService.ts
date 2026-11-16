import type { ToolPermissions } from "../schemas/toolPermissions";
import type { Workspace } from "../workspaces/WorkspaceService";
import { type PermissionScope, matchesRule, ruleSpecificity } from "./rules";

export type RunPermissions = {
  readonly shell: {
    readonly network: "isolated" | "host";
    readonly hostToolchains: boolean;
    readonly virtualMemoryKb: number | null;
    readonly foregroundCpuSeconds: number;
    readonly foregroundTimeoutMs: number;
    readonly openFiles: number;
  };
};

export type ToolCallDecision =
  | { action: "allow" }
  | { action: "deny" | "ask"; reason: string };

export class PermissionService {
  resolve(workspace?: Pick<Workspace, "kind">): RunPermissions {
    const development = workspace?.kind === "local";
    return {
      shell: {
        network: development ? "host" : "isolated",
        hostToolchains: development,
        virtualMemoryKb: development ? null : 2097152,
        foregroundCpuSeconds: 60,
        foregroundTimeoutMs: 120_000,
        openFiles: 256,
      },
    };
  }

  callDecision(
    toolPermissions: ToolPermissions,
    tool: string,
    args: Record<string, unknown>,
    scope: PermissionScope = {},
  ): ToolCallDecision {
    const matches = toolPermissions.rules.filter((rule) =>
      matchesRule(rule, tool, args, scope),
    );
    if (matches.some((rule) => rule.action === "deny"))
      return {
        action: "deny",
        reason: `A tool permission rule blocks this ${tool} call`,
      };
    // Later entries win equal specificity; explicit denials always win above.
    const rule = matches.reduce<(typeof matches)[number] | undefined>(
      (selected, candidate) =>
        !selected || ruleSpecificity(candidate) >= ruleSpecificity(selected)
          ? candidate
          : selected,
      undefined,
    );
    const action = rule?.action ?? "allow";
    return action === "allow"
      ? { action }
      : {
          action: "ask",
          reason: `A tool permission rule requires approval for this ${tool} call`,
        };
  }
}

export const permissionService = new PermissionService();
