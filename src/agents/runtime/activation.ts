import { RunContext } from "../../RunContext";
import type {
  OutputAttachment,
  WorkspaceFileAttachment,
} from "../../attachments/types";
import type { AgentRecord, AgentStore } from "../../db/agents";
import { getAttachment } from "../../db/attachments";
import { getSessionById } from "../../db/sessions";
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
  inboxModelContent,
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
  transcriptLength(sessionId: string): number;
  allowModelCall(agent: AgentRecord): boolean;
  tools(
    agent: AgentRecord,
    signal: AbortSignal,
    wait: () => void,
    model: () => string,
  ): BaseTool[];
  enqueue(
    agent: AgentRecord,
    sender: string,
    kind: "result" | "failure",
    content: string,
    attachments?: OutputAttachment[],
  ): unknown;
}

/**
 * The saved history with image bytes loaded back from the attachment store.
 * Other messages stay the saved objects, so saving them again writes nothing.
 */
function historyWithImages(agent: AgentRecord): LlmMessage[] {
  return agent.history.map((message) =>
    message.images
      ? {
          ...message,
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
      : message,
  );
}

export async function runActivation(
  host: ActivationHost,
  agent: AgentRecord,
  signal: AbortSignal,
  partial: Activation,
) {
  agent.status = "running";
  agent.interruption = undefined;
  host.status(agent);
  host.emit(agent.ownerUuid, {
    type: "activation_started",
    sessionId: agent.sessionId,
    agentId: agent.id,
    activation: partial,
  });
  let outcome: "done" | "aborted" | "error" | "paused" = "done";
  let segmentStart = 0;
  const summarySince = agent.lastSummaryAt;
  let ctx: RunContext | undefined;
  let changedFiles: WorkspaceFileAttachment[] = [];
  let attachmentStart = 0;
  let savedReply = "";
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
        ...agent.pendingOutputs,
        ...(ctx?.outputAttachments.slice(attachmentStart) ?? []),
        ...changedFiles,
      ],
      versions: agent.versions,
    });
    agent.pendingOutputs = [];
    attachmentStart = ctx?.outputAttachments.length ?? 0;
    agent.versions = undefined;
    host.store.clearSegment(agent);
    savedReply = "";
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
    let paused = false;
    model.addTools(
      host.tools(
        agent,
        signal,
        () => {
          waiting = true;
        },
        () => model.model,
      ),
    );
    ctx = new RunContext(
      model,
      (context, step) => {
        const position = context.steps.indexOf(step) - segmentStart;
        if (position < 0) return;
        const wire = context.wireStep(step);
        partial.steps[position] = wire;
        // A main agent's rows last until its segment reaches the transcript.
        host.store.saveStep(agent, partial.id, position, wire);
        // Saved with each step, so a restart loses at most one call's text.
        if (agent.kind === "main" && partial.content !== savedReply) {
          host.store.saveReply(agent, partial.content);
          savedReply = partial.content;
        }
        if (step.kind === "llm_call" && step.status === "running") {
          partial.content = "";
          partial.thinking = "";
        }
        host.emit(agent.ownerUuid, {
          type: "step",
          sessionId: agent.sessionId,
          agentId: agent.id,
          activationId: partial.id,
          position,
          step: wire,
        });
      },
      (contentDelta, thinkingDelta) => {
        partial.content += contentDelta;
        partial.thinking += thinkingDelta;
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
      // The write only appends to the model history.
      const savedHistoryLength = model.history.length;
      // Delivery replaces the partial's fields rather than mutating them.
      const savedPartial = { ...partial };
      const savedSegmentStart = segmentStart;
      const savedAttachmentStart = attachmentStart;
      try {
        host.atomically(agent.sessionId, () => {
          paused = !host.allowModelCall(agent);
          if (paused) return;
          const messages = host.store
            .undelivered(agent.id)
            .filter((m) => !m.held);
          const agents = host.store.list(agent.ownerUuid, agent.sessionId);
          let summarized = false;
          for (const message of messages) {
            if (message.kind === "user") {
              closeSegment();
              const position = host.transcriptLength(agent.sessionId);
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
                content: inboxModelContent(message, agents),
              });
            agent.pendingOutputs.push(...message.attachments);
          }
          if (agent.kind === "main") {
            const summary = pendingSummary(
              agents.filter(
                (a) => a.endedAt === null || a.endedAt > summarySince,
              ),
            );
            if (summary !== agent.lastSummary) {
              if (summary)
                model.history.push({ role: "user", content: summary });
              agent.lastSummary = summary;
              agent.lastSummaryAt = Date.now();
              summarized = true;
            }
          }
          host.store.deliver(messages);
          // A step with nothing delivered leaves the record unchanged.
          if (messages.length || summarized) host.store.save(agent);
          host.store.saveHistory(agent, model.history);
        });
        // A user message sent during the activation may have changed these.
        model.model = agent.model;
        model.reasoningEffort = agent.config.reasoningEffort;
        return !paused;
      } catch (error) {
        model.history.length = savedHistoryLength;
        Object.assign(partial, savedPartial);
        segmentStart = savedSegmentStart;
        attachmentStart = savedAttachmentStart;
        throw error;
      }
    };
    const result = await model.run("", ctx);
    host.store.saveHistory(agent, model.history);
    changedFiles = await changedWorkspaceFiles(
      workspace,
      ctx.writtenFiles,
      agent.sessionId,
      host.temporaryHistory.has(agent.sessionId),
    );
    host.atomically(agent.sessionId, closeSegment);
    if (signal.aborted) {
      outcome = "aborted";
      agent.status = agent.kind === "main" ? "idle" : "cancelled";
    }
    // A subagent stays ready for follow-ups until it is dismissed.
    else agent.status = waiting ? "waiting" : "idle";
    if (paused && !signal.aborted) outcome = "paused";
    // A main agent's reply is in the transcript.
    if (agent.kind !== "main")
      agent.activity = paused
        ? "Automatic work paused. Waiting for the user to continue."
        : result;
    const outputAttachments = ctx.outputAttachments;
    host.atomically(agent.sessionId, () => {
      if (agent.kind !== "main")
        agent.pendingOutputs.push(...outputAttachments, ...changedFiles);
      if (!paused && agent.status === "idle" && agent.parentId) {
        const parent = host.store.get(agent.parentId);
        if (parent && !host.isDeleting(agent.sessionId)) {
          host.enqueue(
            parent,
            agent.id,
            "result",
            result,
            agent.pendingOutputs,
          );
          agent.pendingOutputs = [];
        }
      }
      host.store.save(agent);
    });
  } catch (error) {
    outcome = signal.aborted ? "aborted" : "error";
    // An error ends the activation, not the agent: it keeps its context.
    agent.status =
      signal.aborted && agent.kind !== "main" ? "cancelled" : "idle";
    agent.activity = error instanceof Error ? error.message : String(error);
    ctx?.failLastRunningStep(agent.activity);
    if (agent.kind === "main") {
      host.atomically(agent.sessionId, () => {
        // Keep failed input available for Deliver without immediately retrying it.
        if (!signal.aborted) host.store.hold(agent.id, true);
        partial.content ||= `Error: ${agent.activity}`;
        closeSegment();
      });
    } else if (!signal.aborted && agent.parentId) {
      const parent = host.store.get(agent.parentId);
      agent.interruption = agent.activity;
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
