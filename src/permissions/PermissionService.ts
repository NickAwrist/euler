import {
  type Capabilities,
  capabilitiesSchema,
} from "../schemas/userPreferences";
import { BUILTIN_TOOLS, type BuiltinTool } from "../tools/builtinTools";
import type { Workspace } from "../workspaces/WorkspaceService";

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

export class PermissionService {
  resolve(
    workspace?: Pick<Workspace, "kind">,
    capabilities: Capabilities = capabilitiesSchema.parse({}),
  ): RunPermissions {
    const development = workspace?.kind === "local";
    return {
      capabilities: { ...capabilities },
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
}

export const permissionService = new PermissionService();

export function enabledBuiltinTools(
  permissions: RunPermissions,
): BuiltinTool[] {
  return BUILTIN_TOOLS.filter(
    (tool) => permissionService.toolDecision(permissions, tool).allowed,
  );
}
