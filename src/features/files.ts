import { ApplyPatchTool } from "../tools/apply_patch";
import { CreateFileTool } from "../tools/create_file";
import { DeleteFileTool } from "../tools/delete_file";
import { GrepTool } from "../tools/grep";
import { ListFilesTool } from "../tools/list_files";
import { ReadFileTool } from "../tools/read_file";
import {
  CAPABLE,
  type Capability,
  type FeatureTools,
  WORKSPACE_COMMANDS,
  WorkspaceFeature,
} from "./Feature";

export class FilesFeature extends WorkspaceFeature {
  readonly id = "files";
  readonly label = "Files";
  readonly description =
    "Read, search, create, edit, and delete workspace files.";
  readonly toolNames = [
    "create_file",
    "delete_file",
    "grep",
    "list_files",
    "read_file",
    "apply_patch",
  ];
  override readonly sidebarTab = "Files";
  override readonly commands = [
    ...WORKSPACE_COMMANDS,
    { name: "workspace", description: "Show files in this chat's workspace" },
  ];

  async capable(): Promise<Capability> {
    // Workspace paths are opened through procfs.
    return process.platform === "linux"
      ? CAPABLE
      : { capable: false, reason: "Requires Linux" };
  }

  override async tools(): Promise<FeatureTools> {
    return {
      tools: [
        new CreateFileTool(),
        new DeleteFileTool(),
        new GrepTool(),
        new ListFilesTool(),
        new ReadFileTool(),
        new ApplyPatchTool(),
      ],
    };
  }
}
