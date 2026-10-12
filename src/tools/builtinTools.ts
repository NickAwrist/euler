import type { Capabilities } from "../schemas/userPreferences";
import type { BaseTool } from "./BaseTool";
import { ApplyPatchTool } from "./apply_patch";
import { BashTool } from "./bash";
import { CreateFileTool } from "./create_file";
import { DeleteFileTool } from "./delete_file";
import { FetchWebPageTool } from "./fetch_web_page";
import { GenerateImageTool } from "./generate_image";
import { GrepTool } from "./grep";
import { ListFilesTool } from "./list_files";
import { ReadFileTool } from "./read_file";
import { WebSearchTool } from "./web_search";

export const BUILTIN_TOOL_REGISTRY = [
  {
    name: "create_file",
    capability: "files",
    create: () => new CreateFileTool(),
  },
  {
    name: "delete_file",
    capability: "files",
    create: () => new DeleteFileTool(),
  },
  { name: "grep", capability: "files", create: () => new GrepTool() },
  {
    name: "list_files",
    capability: "files",
    create: () => new ListFilesTool(),
  },
  { name: "read_file", capability: "files", create: () => new ReadFileTool() },
  {
    name: "apply_patch",
    capability: "files",
    create: () => new ApplyPatchTool(),
  },
  { name: "web_search", capability: "web", create: () => new WebSearchTool() },
  {
    name: "fetch_web_page",
    capability: "web",
    create: () => new FetchWebPageTool(),
  },
  { name: "bash", capability: "shell", create: () => new BashTool() },
  {
    name: "generate_image",
    capability: "imageGeneration",
    create: () => new GenerateImageTool(),
  },
] as const satisfies readonly {
  name: string;
  capability: keyof Capabilities;
  create(): BaseTool;
}[];

export const BUILTIN_TOOLS = BUILTIN_TOOL_REGISTRY.map((tool) => tool.name);
export type BuiltinTool = (typeof BUILTIN_TOOLS)[number];

export function createBuiltinTool(name: string): BaseTool {
  const tool = BUILTIN_TOOL_REGISTRY.find((tool) => tool.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.create();
}
