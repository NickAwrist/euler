import type { Capabilities } from "../schemas/userPreferences";

export const BUILTIN_TOOLS = [
  "create_file",
  "delete_file",
  "grep",
  "list_files",
  "modify_plan",
  "read_file",
  "apply_patch",
  "web_search",
  "fetch_web_page",
  "bash",
  "generate_image",
] as const;

type BuiltinTool = (typeof BUILTIN_TOOLS)[number];

/** The capability that provides each tool; `null` tools are always on. */
const TOOL_CAPABILITY: Record<BuiltinTool, keyof Capabilities | null> = {
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
};

export function enabledBuiltinTools(capabilities: Capabilities): BuiltinTool[] {
  return BUILTIN_TOOLS.filter((tool) => {
    const capability = TOOL_CAPABILITY[tool];
    return capability === null || capabilities[capability];
  });
}
