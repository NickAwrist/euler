import { RunContext } from "../../RunContext";
import type { WorkspaceFileAttachment } from "../../attachments/types";
import type { AgentRecord, AgentStore } from "../../db/agents";
import { getAttachment } from "../../db/attachments";
import { getMessagesForSession, getSessionById } from "../../db/sessions";
import type { Unsequenced } from "../../events/eventHub";
import type { LlmMessage } from "../../llm";
import { isFinalAgent } from "../../schemas/agents";
import type { Activation } from "../../schemas/events";
import type { WireMessageInput } from "../../schemas/run";
import type { BaseTool } from "../../tools/BaseTool";
import { workspaceService } from "../../workspaces/WorkspaceService";
import { agentManager, buildServerRunPromptContext } from "../agentManager";
import {
  INBOX_DIRECTIVES,
  agentEnvelope,
  pendingSummary,
} from "./agentContext";
import { changedWorkspaceFiles } from "./workspaceOutputs";

export interface ActivationHost {
  store: AgentStore;
  temporaryHistory: Map<string, WireMessageInput[]>;
  status(agent: AgentRecord): void;
  emit(owner: string, event: Unsequenced): void;
  append(agent: AgentRecord, message: WireMessageInput): void;
  atomically(sessionId: string, write: () => void): void;
  isDeleting(sessionId: string): boolean;
  tools(
    agent: AgentRecord,
    signal: AbortSignal,
    wait: () => void,
    model: string,
  ): BaseTool[];
  enqueue(
    agent: AgentRecord,
    sender: string,
    kind: "result" | "failure",
    content: string,
  ): unknown;
}

/** The saved history with image bytes loaded back from the attachment store. */
function historyWithImages(agent: AgentRecord): LlmMessage[] {
  return agent.history.map((message) => ({
    ...message,
    ...(message.images
      ? {
          images: message.images.flatMap((image) => {
            const stored = getAttachment(agent.ownerUuid, image.id);
            return stored?.sessionId === agent.sessionId
              ? [
                  {
                    ...image,
                    data: Buffer.from(stored.data).toString("base64"),
                  },
                ]
              : [];
          }),
        }
      : {}),
  }));
}

export async function runActivation(
  host: ActivationHost,
  agent: AgentRecord,
  signal: AbortSignal,
  partial: Activation,
) {
  agent.status = "running";
  if (
    agent.kind === "main" &&
    !host.store.undelivered(agent.id).some((m) => m.kind === "user")
  )
    agent.wakes++;
  host.status(agent);
  host.emit(agent.ownerUuid, {
    type: "activation_started",
    sessionId: agent.sessionId,
    agentId: agent.id,
    activation: partial,
  });
  let outcome: "done" | "aborted" | "error" = "done";
  let segmentStart = 0;
  const summarySince = agent.lastSummaryAt;
  let lastSummaryText = "";
  const previousSteps = agent.kind === "main" ? [] : agent.steps;
  let ctx: RunContext | undefined;
  let changedFiles: WorkspaceFileAttachment[] = [];
  let attachmentStart = 0;
  const closeSegment = () => {
    if (
      agent.kind !== "main" ||
      (!partial.content && partial.steps.length === 0)
    )
      return;
    host.append(agent, {
      role: "assistant",
      activationId: partial.id,
      content: partial.content,
      steps: partial.steps,
      attachments: [
        ...(ctx?.outputAttachments.slice(attachmentStart) ?? []),
        ...changedFiles,
      ],
      versions: agent.versions,
    });
    attachmentStart = ctx?.outputAttachments.length ?? 0;
    agent.versions = undefined;
    agent.partial = undefined;
    host.store.save(agent);
    segmentStart = ctx?.steps.length ?? 0;
    partial.steps = [];
    partial.content = "";
    partial.thinking = "";
  };
  try {
    const session = getSessionById(agent.ownerUuid, agent.sessionId);
    const workspace = session
      ? await workspaceService.resolveSession(session)
      : await workspaceService.resolveTemporary(
          agent.ownerUuid,
          agent.sessionId,
        );
    const options = {
      ownerUuid: agent.ownerUuid,
      toolSessionDir: workspace.hostPath,
      promptContext: buildServerRunPromptContext({
        metadata: agent.config.metadata,
        toolSessionDir: workspace.displayPath,
      }),
      reasoningEffort: agent.config.reasoningEffort,
      userPrompt: host.store
        .undelivered(agent.id)
        .filter((m) => m.kind === "user" || m.kind === "task")
        .map((m) => m.content)
        .join("\n"),
    };
    const model =
      agent.kind === "main"
        ? agentManager.createAgent(options)
        : agentManager.createGeneralAgent(options);
    model.model = agent.model;
    model.history = historyWithImages(agent);
    model.systemPrompt += `\n\n${INBOX_DIRECTIVES}`;
    let waiting = false;
    model.addTools(
      host.tools(
        agent,
        signal,
        () => {
          waiting = true;
        },
        model.model,
      ),
    );
    ctx = new RunContext(
      model,
      "",
      (context, step) => {
        const allSteps = context.wireSteps();
        partial.steps = allSteps.slice(segmentStart);
        agent.steps = [...previousSteps, ...allSteps];
        agent.partial = {
          role: "assistant",
          content: partial.content,
          steps: partial.steps,
        };
        if (step.kind === "llm_call" && step.status === "running") {
          partial.content = "";
          partial.thinking = "";
        }
        host.store.save(agent);
        host.emit(agent.ownerUuid, {
          type: "step",
          sessionId: agent.sessionId,
          agentId: agent.id,
          activationId: partial.id,
          steps: partial.steps,
        });
      },
      (contentDelta, thinkingDelta) => {
        partial.content += contentDelta;
        partial.thinking += thinkingDelta;
        // Saved with the next step, so a restart loses at most one call's text.
        agent.partial = {
          role: "assistant",
          content: partial.content,
          steps: partial.steps,
        };
        host.emit(agent.ownerUuid, {
          type: "delta",
          sessionId: agent.sessionId,
          agentId: agent.id,
          activationId: partial.id,
          contentDelta,
          thinkingDelta,
        });
      },
      signal,
      workspace.hostPath,
      options.promptContext,
      agent.ownerUuid,
      workspace,
    );
    model.checkpoint = () => host.store.saveHistory(agent, model.history);
    model.hasPendingInput = () =>
      !waiting && host.store.hasWakingMessage(agent.id, false);
    model.beforeModelCall = async () => {
      const savedHistory = structuredClone(model.history);
      const savedPartial = structuredClone(partial);
      const savedSegmentStart = segmentStart;
      const savedAttachmentStart = attachmentStart;
      const savedSummary = lastSummaryText;
      try {
        host.atomically(agent.sessionId, () => {
          const messages = host.store
            .undelivered(agent.id)
            .filter((m) => !m.held);
          const agents = host.store.list(agent.ownerUuid, agent.sessionId);
          for (const message of messages) {
            if (message.kind === "user") {
              closeSegment();
              const position = (
                host.temporaryHistory.get(agent.sessionId) ??
                getMessagesForSession(agent.ownerUuid, agent.sessionId)
              ).length;
              agent.checkpoints[String(position)] = model.history.length;
              const attachments = message.attachmentIds
                .map((id) => getAttachment(agent.ownerUuid, id))
                .filter((a) => a !== null)
                .filter((a) => a.sessionId === agent.sessionId);
              host.append(agent, {
                role: "user",
                content: message.content,
                attachments: attachments.map(
                  ({
                    data: _data,
                    ownerUuid: _owner,
                    sessionId: _session,
                    createdAt: _at,
                    ...ref
                  }) => ref,
                ),
              });
              model.history.push({
                role: "user",
                content: message.content,
                images: attachments.map((a) => ({
                  ...a,
                  data: Buffer.from(a.data).toString("base64"),
                })),
              });
            } else
              model.history.push({
                role: "user",
                content:
                  message.kind === "task"
                    ? message.content
                    : agentEnvelope(message, agents),
              });
          }
          if (agent.kind === "main") {
            const summary = pendingSummary(
              agents.filter(
                (a) => a.endedAt === null || a.endedAt > summarySince,
              ),
            );
            if (summary !== lastSummaryText) {
              model.history.push({ role: "user", content: summary });
              lastSummaryText = summary;
              agent.lastSummaryAt = Date.now();
            }
          }
          host.store.deliver(messages);
          host.store.save(agent);
          host.store.saveHistory(agent, model.history);
        });
      } catch (error) {
        model.history = savedHistory;
        Object.assign(partial, savedPartial);
        segmentStart = savedSegmentStart;
        attachmentStart = savedAttachmentStart;
        lastSummaryText = savedSummary;
        throw error;
      }
    };
    const result = await model.run("", ctx);
    host.store.saveHistory(agent, model.history);
    if (agent.kind === "main")
      changedFiles = await changedWorkspaceFiles(
        workspace,
        ctx.writtenFiles,
        agent.sessionId,
        host.temporaryHistory.has(agent.sessionId),
      );
    closeSegment();
    if (signal.aborted) {
      outcome = "aborted";
      agent.status = agent.kind === "main" ? "idle" : "cancelled";
    }
    // A subagent stays ready for follow-ups until it is dismissed.
    else agent.status = waiting ? "waiting" : "idle";
    agent.activity = result;
    if (isFinalAgent(agent)) agent.endedAt = Date.now();
    host.atomically(agent.sessionId, () => {
      host.store.save(agent);
      if (agent.status === "idle" && agent.parentId) {
        const parent = host.store.get(agent.parentId);
        if (parent && !host.isDeleting(agent.sessionId))
          host.enqueue(parent, agent.id, "result", result);
      }
    });
  } catch (error) {
    outcome = signal.aborted ? "aborted" : "error";
    agent.status =
      agent.kind === "main" ? "idle" : signal.aborted ? "cancelled" : "failed";
    agent.activity = error instanceof Error ? error.message : String(error);
    ctx?.failLastRunningStep(agent.activity);
    if (agent.kind === "main") {
      partial.content ||= `Error: ${agent.activity}`;
      closeSegment();
    } else if (!signal.aborted && agent.parentId) {
      const parent = host.store.get(agent.parentId);
      agent.endedAt = Date.now();
      host.atomically(agent.sessionId, () => {
        host.store.save(agent);
        if (parent && !host.isDeleting(agent.sessionId))
          host.enqueue(parent, agent.id, "failure", agent.activity);
      });
    }
  } finally {
    if (isFinalAgent(agent)) agent.endedAt = Date.now();
    host.status(agent);
    host.emit(agent.ownerUuid, {
      type: "activation_ended",
      sessionId: agent.sessionId,
      agentId: agent.id,
      activationId: partial.id,
      outcome,
    });
  }
}
