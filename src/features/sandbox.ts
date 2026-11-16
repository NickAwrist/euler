import { sandboxRunner } from "../sandbox/SandboxRunner";
import { BashTool } from "../tools/bash";
import { JobTool } from "../tools/jobs";
import {
  type Capability,
  type FeatureRun,
  type FeatureTools,
  WorkspaceFeature,
} from "./Feature";

export class SandboxFeature extends WorkspaceFeature {
  readonly id = "sandbox";
  readonly label = "Sandbox";
  readonly description = "Run commands in the active workspace.";
  readonly toolNames = ["bash", "get_job", "cancel_job"];
  override readonly sidebarTab = "Jobs";

  override capable(): Promise<Capability> {
    return sandboxRunner.capability();
  }

  // Jobs are background shell commands, so their tools come with the shell.
  override async tools(run: FeatureRun): Promise<FeatureTools> {
    return {
      tools: [
        new BashTool(),
        new JobTool("get_job", run.host.readJob),
        new JobTool("cancel_job", run.host.cancelJob),
      ],
    };
  }
}
