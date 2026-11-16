import type { ServiceImpl } from "@connectrpc/connect";
import {
  agentManager,
  buildServerRunPromptContext,
} from "../agents/agentManager";
import { activeFeatures } from "../features/index";
import type { DebugService } from "../gen/euler/v1/debug_pb";
import { WORKSPACE_PATH } from "../workspaces/WorkspaceService";
import { runMetadata } from "./agent";
import { ownerOf } from "./context";

export const debugService: ServiceImpl<typeof DebugService> = {
  async previewPrompt(request, context) {
    const owner = ownerOf(context);
    const features = await activeFeatures(owner);
    const usesWorkspace = features.some((feature) => feature.usesWorkspace);
    const agent = agentManager.createAgent("main", {
      features,
      promptContext: buildServerRunPromptContext({
        metadata: runMetadata(request.metadata),
        sessionDirectory: usesWorkspace ? WORKSPACE_PATH : undefined,
      }),
      ownerUuid: owner,
      userPrompt: request.message,
    });
    return { systemPrompt: agent.systemPrompt };
  },
};
