import type { ServiceImpl } from "@connectrpc/connect";
import {
  agentManager,
  buildServerRunPromptContext,
} from "../agents/agentManager";
import { INBOX_DIRECTIVES } from "../agents/runtime/agentContext";
import type { DebugService } from "../gen/euler/v1/debug_pb";
import { workspaceService } from "../workspaces/WorkspaceService";
import { runMetadata } from "./agent";
import { ownedSession, ownerOf } from "./context";

export const debugService: ServiceImpl<typeof DebugService> = {
  async previewPrompt(request, context) {
    const owner = ownerOf(context);
    const sessionId = request.sessionId?.trim();
    const workspace = sessionId
      ? await workspaceService.resolveSession(ownedSession(context, sessionId))
      : undefined;
    const agent = agentManager.createAgent({
      promptContext: buildServerRunPromptContext({
        metadata: runMetadata(request.metadata),
        toolSessionDir: workspace?.displayPath ?? "/workspace",
      }),
      toolSessionDir: workspace?.hostPath,
      ownerUuid: owner,
      userPrompt: request.message,
    });
    return { systemPrompt: `${agent.systemPrompt}\n\n${INBOX_DIRECTIVES}` };
  },
};
