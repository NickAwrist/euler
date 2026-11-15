import type { ServiceImpl } from "@connectrpc/connect";
import {
  agentManager,
  buildServerRunPromptContext,
} from "../agents/agentManager";
import { INBOX_DIRECTIVES } from "../agents/runtime/agentContext";
import { activeFeatures } from "../features/index";
import type { DebugService } from "../gen/euler/v1/debug_pb";
import { workspaceService } from "../workspaces/WorkspaceService";
import { runMetadata } from "./agent";
import { ownedSession, ownerOf } from "./context";

export const debugService: ServiceImpl<typeof DebugService> = {
  async previewPrompt(request, context) {
    const owner = ownerOf(context);
    const sessionId = request.sessionId?.trim();
    const features = await activeFeatures(owner);
    const usesWorkspace = features.some((feature) => feature.usesWorkspace);
    const session = sessionId ? ownedSession(context, sessionId) : undefined;
    const workspace =
      session && usesWorkspace
        ? await workspaceService.resolveSession(session)
        : undefined;
    const agent = agentManager.createAgent({
      features,
      promptContext: buildServerRunPromptContext({
        metadata: runMetadata(request.metadata),
        toolSessionDir:
          workspace?.displayPath ?? (usesWorkspace ? "/workspace" : undefined),
      }),
      toolSessionDir: workspace?.hostPath,
      ownerUuid: owner,
      userPrompt: request.message,
    });
    return { systemPrompt: `${agent.systemPrompt}\n\n${INBOX_DIRECTIVES}` };
  },
};
