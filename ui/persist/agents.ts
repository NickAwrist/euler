import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  GetRuntimeResponse,
  TurnSettingsSchema,
} from "../../src/gen/euler/v1/agent_pb";
import type { ApprovalDecision } from "../../src/gen/euler/v1/permissions_pb";
import type { MessageVersion } from "../../src/gen/euler/v1/sessions_pb";
import { agentClient, sessionClient } from "../lib/rpc";
import type { MessageFields } from "../types";

/** A chat's live state, as of the event sequence it carries. */
export type RuntimeSnapshot = MessageFields<GetRuntimeResponse>;
export type TurnSettings = MessageInitShape<typeof TurnSettingsSchema>;

export async function fetchRuntime(
  sessionId: string,
): Promise<RuntimeSnapshot> {
  return agentClient.getRuntime({ sessionId });
}

export async function sendMessage(
  sessionId: string,
  content: string,
  attachmentIds: string[],
  settings: TurnSettings,
) {
  await agentClient.sendMessage({
    sessionId,
    content,
    attachmentIds,
    settings,
  });
}

/** Runs the user message at `position` again, keeping earlier replies as versions. */
export async function rewindTo(
  sessionId: string,
  position: number,
  content: string,
  versions: MessageVersion[] | undefined,
  settings: TurnSettings,
) {
  await agentClient.rewind({
    sessionId,
    position,
    content,
    versions,
    settings,
  });
}

export async function stopTurn(sessionId: string) {
  await agentClient.stop({ sessionId });
}

export async function deliverQueued(sessionId: string) {
  await agentClient.deliver({ sessionId });
}

export async function markSessionViewed(sessionId: string) {
  await sessionClient.markViewed({ id: sessionId });
}

export async function fetchAgent(sessionId: string, agentId: string) {
  return agentClient.getAgent({ sessionId, agentId });
}

export async function cancelAgent(sessionId: string, agentId: string) {
  await agentClient.cancelAgent({ sessionId, agentId });
}

export async function removeQueuedMessage(
  sessionId: string,
  messageId: bigint,
) {
  await agentClient.removeQueued({ sessionId, messageId });
}

export async function respondToToolApproval(
  sessionId: string,
  approvalId: string,
  decision: ApprovalDecision,
) {
  return agentClient.respondToApproval({ sessionId, approvalId, decision });
}
