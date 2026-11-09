import type { HandlerContext, ServiceImpl } from "@connectrpc/connect";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { getOpenRouterApiKey } from "../db";
import { getAttachment } from "../db/attachments";
import type {
  AgentService,
  RunMetadata,
  TurnSettings,
} from "../gen/euler/v1/agent_pb";
import { ApprovalDecision } from "../gen/euler/v1/permissions_pb";
import { resolveModelSelection } from "../llm";
import { chatGptStatus } from "../models/chatgpt";
import { OperationError } from "../observability/errors";
import type { TurnSettings as DomainTurnSettings } from "../schemas/agents";
import { ownedSession } from "./context";
import {
  activation,
  agent,
  fromMessageVersion,
  inboxMessage,
  job,
  message,
  permissionRule,
  step,
  toolApproval,
} from "./wire";

/** Rejects a model whose provider is not set up for the owner. */
function requireModelAvailable(model: string, owner: string) {
  const { provider } = resolveModelSelection(model);
  if (provider === "openrouter" && !getOpenRouterApiKey())
    throw new OperationError("INVALID_REQUEST", {
      message:
        "Configure an OpenRouter API key in Settings before using this model",
    });
  if (provider === "chatgpt" && !chatGptStatus(owner).planEnabled)
    throw new OperationError("INVALID_REQUEST", {
      message: "Connect ChatGPT in Settings before using this model",
    });
}

/** Personal context in the runtime's shape, keeping only the fields sent. */
export function runMetadata(
  metadata: RunMetadata | undefined,
): DomainTurnSettings["metadata"] {
  if (!metadata) return undefined;
  return {
    ...(metadata.systemPrompt === undefined
      ? {}
      : { systemPrompt: metadata.systemPrompt }),
    ...(metadata.name === undefined ? {} : { name: metadata.name }),
    ...(metadata.location === undefined ? {} : { location: metadata.location }),
    ...(metadata.preferredFormats === undefined
      ? {}
      : { preferredFormats: metadata.preferredFormats }),
    ...(metadata.includeCurrentDate === undefined
      ? {}
      : { includeCurrentDate: metadata.includeCurrentDate }),
  };
}

function turnSettings(settings: TurnSettings | undefined): DomainTurnSettings {
  const metadata = runMetadata(settings?.metadata);
  return {
    ...(settings?.model === undefined ? {} : { model: settings.model }),
    ...(settings?.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: settings.reasoningEffort }),
    ...(metadata ? { metadata } : {}),
  };
}

const DECISIONS = {
  [ApprovalDecision.ALLOW_ONCE]: "allow_once",
  [ApprovalDecision.ALLOW_MATCHING]: "allow_matching",
  [ApprovalDecision.DENY]: "deny",
} as const;

function mainAgent(context: HandlerContext, sessionId: string) {
  const { owner_uuid: owner, id } = ownedSession(context, sessionId);
  return { owner, id, main: agentRuntime.main(owner, id) };
}

export const agentService: ServiceImpl<typeof AgentService> = {
  getRuntime(request, context) {
    const { owner_uuid: owner, id } = ownedSession(context, request.sessionId);
    const snapshot = agentRuntime.snapshot(owner, id);
    return {
      sequence: BigInt(snapshot.sequence),
      agents: snapshot.agents.map(agent),
      jobs: snapshot.jobs.map(job),
      activation: snapshot.activation
        ? activation(snapshot.activation)
        : undefined,
      queued: snapshot.queued.map(inboxMessage),
      held: snapshot.held,
      history: snapshot.history.map(message),
      approvals: snapshot.approvals.map(toolApproval),
    };
  },
  sendMessage(request, context) {
    const { owner, id } = mainAgent(context, request.sessionId);
    if (agentRuntime.isChanging(id))
      throw new OperationError("CONFLICT", {
        message:
          "The conversation is being changed. Try again when it finishes.",
      });
    if (
      request.attachmentIds.some(
        (attachmentId) => getAttachment(owner, attachmentId)?.sessionId !== id,
      )
    )
      throw new OperationError("INVALID_REQUEST", {
        message: "Invalid attachment",
      });
    const main = agentRuntime.main(owner, id);
    const settings = turnSettings(request.settings);
    requireModelAvailable(settings.model ?? main.model, owner);
    const { message: sent, queued } = agentRuntime.send(main, {
      ...settings,
      content: request.content.trim(),
      attachmentIds: request.attachmentIds,
    });
    return { messageId: BigInt(sent.id), queued };
  },
  async stop(request, context) {
    await agentRuntime.cancel(mainAgent(context, request.sessionId).main);
    return {};
  },
  deliver(request, context) {
    agentRuntime.deliver(mainAgent(context, request.sessionId).main);
    return {};
  },
  removeQueued(request, context) {
    const { main } = mainAgent(context, request.sessionId);
    if (!agentRuntime.removeQueued(main, Number(request.messageId)))
      throw new OperationError("CONFLICT", {
        message: "Message was already delivered",
      });
    return {};
  },
  async rewind(request, context) {
    const { owner, id, main } = mainAgent(context, request.sessionId);
    const settings = turnSettings(request.settings);
    requireModelAvailable(settings.model ?? main.model, owner);
    await agentRuntime.rewind(owner, id, {
      ...settings,
      position: request.position,
      ...(request.content === undefined
        ? {}
        : { content: request.content.trim() }),
      versions: request.versions.map(fromMessageVersion),
    });
    return {};
  },
  getAgent(request, context) {
    const { owner_uuid: owner, id } = ownedSession(context, request.sessionId);
    const agents = agentRuntime.store.view(owner, id);
    const found = agents.find((a) => a.id === request.agentId);
    if (!found)
      throw new OperationError("NOT_FOUND", { message: "Agent not found" });
    const messages = agents
      .flatMap((a) => agentRuntime.store.inbox(a.id))
      .filter((m) => m.agentId === found.id || m.sender === found.id)
      .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    return {
      agent: agent(found),
      steps: agentRuntime.store.steps(found.id).map(step),
      messages: messages.map(inboxMessage),
    };
  },
  async cancelAgent(request, context) {
    const { owner_uuid: owner, id } = ownedSession(context, request.sessionId);
    const visible = agentRuntime.store
      .view(owner, id)
      .find((a) => a.id === request.agentId && a.kind !== "main");
    const record = visible ? agentRuntime.store.get(visible.id) : undefined;
    if (!record)
      throw new OperationError("NOT_FOUND", { message: "Agent not found" });
    await agentRuntime.cancel(record);
    return {};
  },
  async respondToApproval(request, context) {
    const { owner_uuid: owner, id } = ownedSession(context, request.sessionId);
    const decision =
      DECISIONS[request.decision as keyof typeof DECISIONS] ?? "deny";
    const result = await agentRuntime.approvals.respond(
      owner,
      id,
      request.approvalId,
      { decision },
    );
    return { rule: result.rule ? permissionRule(result.rule) : undefined };
  },
};
