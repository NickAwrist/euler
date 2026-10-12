import {
  type ToolPermissions,
  ToolPermissionsSchema,
} from "../schemas/toolPermissions";
import {
  type Capabilities,
  capabilitiesSchema,
} from "../schemas/userPreferences";
import { BUILTIN_TOOLS, type BuiltinTool } from "../tools/builtinTools";
import type { Workspace } from "../workspaces/WorkspaceService";
import { type PermissionScope, matchesRule, ruleSpecificity } from "./rules";

/** User capability switches gate built-in tools, not user-configured MCP tools. */
type GatedTool = BuiltinTool | "manage_skills";
const TOOL_CAPABILITY: Record<GatedTool, keyof Capabilities | null> = {
  create_file: "files",
  delete_file: "files",
  grep: "files",
  list_files: "files",
  modify_plan: null,
  read_file: "files",
  apply_patch: "files",
  web_search: "web",
  fetch_web_page: "web",
  bash: "shell",
  generate_image: "imageGeneration",
  manage_skills: "skills",
};

export type RunPermissions = {
  readonly toolPermissions: ToolPermissions;
  readonly capabilities: Readonly<Capabilities>;
  readonly shell: {
    readonly network: "isolated" | "host";
    readonly hostToolchains: boolean;
    readonly virtualMemoryKb: number | null;
    readonly foregroundCpuSeconds: number;
    readonly foregroundTimeoutMs: number;
    readonly openFiles: number;
  };
};

export type PermissionDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export type ToolCallDecision =
  | { action: "allow" }
  | { action: "deny" | "ask"; reason: string };

export class PermissionService {
  resolve(
    workspace?: Pick<Workspace, "kind">,
    capabilities: Capabilities = capabilitiesSchema.parse({}),
    toolPermissions: ToolPermissions = ToolPermissionsSchema.parse({}),
  ): RunPermissions {
    const development = workspace?.kind === "local";
    return {
      capabilities: { ...capabilities },
      toolPermissions: structuredClone(toolPermissions),
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

  toolDecision(
    permissions: RunPermissions,
    toolName: string,
  ): PermissionDecision {
    const capability = Object.hasOwn(TOOL_CAPABILITY, toolName)
      ? TOOL_CAPABILITY[toolName as GatedTool]
      : null;
    if (capability && !permissions.capabilities[capability]) {
      return {
        allowed: false,
        reason: `The ${capability} capability is disabled for this run`,
      };
    }
    return { allowed: true };
  }

  assertTool(permissions: RunPermissions, toolName: string): void {
    const decision = this.toolDecision(permissions, toolName);
    if (!decision.allowed) throw new Error(decision.reason);
  }

  callDecision(
    permissions: RunPermissions,
    tool: string,
    args: Record<string, unknown>,
    scope: PermissionScope = {},
  ): ToolCallDecision {
    const capability = this.toolDecision(permissions, tool);
    if (!capability.allowed)
      return { action: "deny", reason: capability.reason };
    const matches = permissions.toolPermissions.rules.filter((rule) =>
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

export function enabledBuiltinTools(
  permissions: RunPermissions,
): BuiltinTool[] {
  return BUILTIN_TOOLS.filter(
    (tool) => permissionService.toolDecision(permissions, tool).allowed,
  );
}
