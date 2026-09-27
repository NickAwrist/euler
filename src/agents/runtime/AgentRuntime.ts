import type { Tool } from "ollama";
import { RunContext } from "../../RunContext";
import type { WorkspaceFileAttachment } from "../../attachments/types";
import { ImageAttachmentSchema } from "../../attachments/types";
import { DEFAULT_RUN_MODEL } from "../../constants";
import { type AgentRecord, AgentStore } from "../../db/agents";
import { getAttachment } from "../../db/attachments";
import { getDb } from "../../db/connection";
import {
  appendRuntimeMessage,
  getMessagesForSession,
  getSessionById,
  parseModelMessages,
} from "../../db/sessions";
import { eventHub } from "../../events/eventHub";
import { ApiError } from "../../http/errors";
import type { LlmMessage } from "../../llm";
import { AgentSchema } from "../../schemas/agents";
import {
  type InboxMessage,
  isFinalAgent,
  isWorkingAgent,
} from "../../schemas/agents";
import type { Activation } from "../../schemas/events";
import { ModelMessageSchema } from "../../schemas/modelMessages";
import type { WireMessageInput } from "../../schemas/run";
import { BaseTool, type ToolResult } from "../../tools/BaseTool";
import { workspaceService } from "../../workspaces/WorkspaceService";
import { agentManager, buildServerRunPromptContext } from "../agentManager";
import {
  INBOX_DIRECTIVES,
  agentEnvelope,
  pendingSummary,
} from "./agentContext";
import { changedWorkspaceFiles, snapshotWorkspace } from "./workspaceOutputs";

class RuntimeTool extends BaseTool {
  constructor(
    name: string,
    description: string,
    private parameters: NonNullable<Tool["function"]["parameters"]>,
    private action: (args: Record<string, unknown>) => Promise<ToolResult>,
  ) {
    super(name, description);
  }
  override toTool(): Tool {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
  override execute(args: Record<string, unknown>) {
    return this.action(args);
  }
}
const parameters = (
  properties: Record<string, { type: string }>,
  required: string[],
) => ({ type: "object", properties, required });
const text = (args: Record<string, unknown>, key: string) => {
  const value = args[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${key} is required`);
  return value;
};

export class AgentRuntime {
  readonly store = new AgentStore();
  private active = new Map<
    string,
    { controller: AbortController; promise: Promise<void>; partial: Activation }
  >();
  private temporaryHistory = new Map<string, WireMessageInput[]>();
  private deleting = new Set<string>();
  private rewinding = new Set<string>();
  resync(owner: string, sessionId: string) {
    eventHub.publish(owner, { type: "resync", sessionId, agentId: "" });
  }
  isChanging(sessionId: string) {
    return this.deleting.has(sessionId) || this.rewinding.has(sessionId);
  }
  private scheduled = false;
  private waitingForChild = new Set<string>();
  private waiters = new Set<() => void>();
  /** Activations holding one of the owner's slots; a blocking spawn releases its slot. */
  private runningCount(owner: string) {
    return [...this.active.keys()].filter(
      (id) =>
        !this.waitingForChild.has(id) &&
        this.store.get(id)?.ownerUuid === owner,
    ).length;
  }
  /** Resolves once `ready` holds or `signal` aborts, re-checked on agent changes. */
  private until(ready: () => boolean, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      const check = () => {
        if (!signal.aborted && !ready()) return;
        this.waiters.delete(check);
        signal.removeEventListener("abort", check);
        resolve();
      };
      this.waiters.add(check);
      signal.addEventListener("abort", check);
      check();
    });
  }
  private notify() {
    for (const check of [...this.waiters]) check();
  }

  main(owner: string, sessionId: string, temporary = false): AgentRecord {
    const existing = this.store
      .list(owner, sessionId)
      .find((a) => a.kind === "main");
    if (existing) return existing;
    const session = getSessionById(owner, sessionId);
    if (!session && !temporary) throw new Error("Session not found");
    const history =
      parseModelMessages(session?.model_messages ?? null) ??
      getMessagesForSession(owner, sessionId).filter((m) => m.role !== "event");
    const agent: AgentRecord = {
      id: crypto.randomUUID(),
      ownerUuid: owner,
      sessionId,
      parentId: null,
      kind: "main",
      title: "Euler",
      status: "idle",
      model: session?.model ?? DEFAULT_RUN_MODEL,
      spawnPosition: 0,
      createdAt: Date.now(),
      endedAt: null,
      activity: "",
      steps: [],
      history: ModelMessageSchema.array().parse(history),
      checkpoints: {},
      lastSummaryAt: 0,
      held: false,
      wakes: 0,
      config: {},
    };
    this.store.save(agent, temporary);
    if (temporary) this.temporaryHistory.set(sessionId, []);
    return agent;
  }
  snapshot(owner: string, sessionId: string) {
    const agents = this.store.list(owner, sessionId);
    const main = agents.find((a) => a.kind === "main");
    return {
      sequence: eventHub.sequence(owner),
      agents: agents.map((a) => AgentSchema.parse(a)),
      activation: main ? (this.active.get(main.id)?.partial ?? null) : null,
      queued: main
        ? this.store
            .inbox(main.id)
            .filter((m) => m.deliveredAt === null && m.kind === "user")
        : [],
      held: Boolean(
        main &&
          (main.held ||
            this.store
              .inbox(main.id)
              .some((m) => m.held && m.deliveredAt === null && m.wakes)),
      ),
      history:
        this.temporaryHistory.get(sessionId) ??
        getMessagesForSession(owner, sessionId),
    };
  }
  busy(owner: string, sessionId: string) {
    return this.store.list(owner, sessionId).some(isWorkingAgent);
  }
  private status(agent: AgentRecord) {
    this.store.save(agent);
    this.notify();
    eventHub.publish(agent.ownerUuid, {
      type: "agent_status",
      sessionId: agent.sessionId,
      agentId: agent.id,
      agent: AgentSchema.parse({
        ...agent,
        held:
          (agent.held && this.pending(agent)) ||
          this.store
            .inbox(agent.id)
            .some((m) => m.held && m.deliveredAt === null && m.wakes),
      }),
    });
  }
  enqueue(
    agent: AgentRecord,
    sender: string,
    kind: InboxMessage["kind"],
    content: string,
    attachmentIds: string[] = [],
  ) {
    if (isFinalAgent(agent) || this.deleting.has(agent.sessionId))
      throw new Error("Agent is no longer accepting messages");
    const message = this.store.enqueue({
      agentId: agent.id,
      sender,
      kind,
      content,
      attachmentIds,
      wakes: !["progress", "status"].includes(kind),
    });
    if (kind === "user") {
      agent.held = false;
      agent.wakes = 0;
      this.store.hold(this.store.inbox(agent.id), false);
      this.store.save(agent);
    }
    eventHub.publish(agent.ownerUuid, {
      type: "inbox_queued",
      sessionId: agent.sessionId,
      agentId: agent.id,
      messages: [message],
    });
    if (agent.held) this.status(agent);
    this.schedule();
    return message;
  }
  private pending(agent: AgentRecord) {
    return this.store
      .inbox(agent.id)
      .some((m) => m.deliveredAt === null && !m.held && m.wakes);
  }
  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.pump();
    });
  }
  private pump() {
    for (const agent of this.store.list()) {
      if (
        this.active.has(agent.id) ||
        isFinalAgent(agent) ||
        agent.held ||
        this.isChanging(agent.sessionId) ||
        !this.pending(agent)
      )
        continue;
      if (agent.kind === "main" && agent.wakes >= 10) {
        agent.held = true;
        this.status(agent);
        continue;
      }
      if (this.runningCount(agent.ownerUuid) >= 4) {
        agent.status = "queued";
        this.status(agent);
        continue;
      }
      const controller = new AbortController();
      const partial: Activation = {
        id: crypto.randomUUID(),
        agentId: agent.id,
        sessionId: agent.sessionId,
        content: "",
        thinking: "",
        steps: [],
      };
      // Install the lock before activation starts, including workspace resolution.
      const promise = Promise.resolve()
        .then(() => this.activate(agent, controller.signal, partial))
        .finally(() => {
          this.active.delete(agent.id);
          this.notify();
          this.schedule();
        });
      this.active.set(agent.id, { controller, promise, partial });
    }
  }
  private append(agent: AgentRecord, message: WireMessageInput) {
    const temporary = this.temporaryHistory.get(agent.sessionId);
    if (temporary) temporary.push(message);
    else
      message.id = appendRuntimeMessage(
        agent.ownerUuid,
        agent.sessionId,
        message,
      );
    eventHub.publish(agent.ownerUuid, {
      type: "transcript_appended",
      sessionId: agent.sessionId,
      agentId: agent.id,
      message,
    });
  }
  private saveHistory(agent: AgentRecord, history: LlmMessage[]) {
    agent.history = history.map((message) => ({
      ...message,
      ...(message.images
        ? {
            images: message.images.map((image) => ({
              ...ImageAttachmentSchema.parse(image),
              data: "",
            })),
          }
        : {}),
    }));
    this.store.save(agent);
  }

  private async activate(
    agent: AgentRecord,
    signal: AbortSignal,
    partial: Activation,
  ) {
    agent.status = "running";
    if (
      agent.kind === "main" &&
      !this.store
        .inbox(agent.id)
        .some((m) => m.kind === "user" && m.deliveredAt === null)
    )
      agent.wakes++;
    this.status(agent);
    eventHub.publish(agent.ownerUuid, {
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
      this.append(agent, {
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
      this.store.save(agent);
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
      const filesBefore =
        agent.kind === "main"
          ? await snapshotWorkspace(workspace)
          : new Map<string, string>();
      const options = {
        ownerUuid: agent.ownerUuid,
        toolSessionDir: workspace.hostPath,
        promptContext: buildServerRunPromptContext({
          metadata: agent.config.metadata,
          toolSessionDir: workspace.displayPath,
        }),
        reasoningEffort: agent.config.reasoningEffort,
        userPrompt: this.store
          .inbox(agent.id)
          .filter(
            (m) =>
              m.deliveredAt === null &&
              (m.kind === "user" || m.kind === "task"),
          )
          .map((m) => m.content)
          .join("\n"),
      };
      const model =
        agent.kind === "main"
          ? agentManager.createAgent(options)
          : agentManager.createGeneralAgent(options);
      model.model = agent.model;
      model.history = agent.history.map((message) => ({
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
      model.systemPrompt += `\n\n${INBOX_DIRECTIVES}`;
      let waiting = false;
      model.addTools(
        this.tools(
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
          this.store.save(agent);
          eventHub.publish(agent.ownerUuid, {
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
          agent.partial = {
            role: "assistant",
            content: partial.content,
            steps: partial.steps,
          };
          this.store.save(agent);
          eventHub.publish(agent.ownerUuid, {
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
      model.checkpoint = () => this.saveHistory(agent, model.history);
      model.hasPendingInput = () => !waiting && this.pending(agent);
      model.beforeModelCall = async () => {
        getDb().transaction(() => {
          const messages = this.store
            .inbox(agent.id)
            .filter((m) => m.deliveredAt === null && !m.held);
          const agents = this.store.list(agent.ownerUuid, agent.sessionId);
          for (const message of messages) {
            if (message.kind === "user") {
              closeSegment();
              const position = (
                this.temporaryHistory.get(agent.sessionId) ??
                getMessagesForSession(agent.ownerUuid, agent.sessionId)
              ).length;
              agent.checkpoints[String(position)] = model.history.length;
              const attachments = message.attachmentIds
                .map((id) => getAttachment(agent.ownerUuid, id))
                .filter((a) => a !== null)
                .filter((a) => a.sessionId === agent.sessionId);
              this.append(agent, {
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
          this.store.deliver(messages);
          model.checkpoint?.();
        })();
      };
      const result = await model.run("", ctx);
      this.saveHistory(agent, model.history);
      if (agent.kind === "main")
        changedFiles = await changedWorkspaceFiles(
          workspace,
          filesBefore,
          agent.sessionId,
          this.temporaryHistory.has(agent.sessionId),
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
      getDb().transaction(() => {
        this.store.save(agent);
        if (agent.status === "idle" && agent.parentId) {
          const parent = this.store.get(agent.parentId);
          if (parent && !this.deleting.has(agent.sessionId))
            this.enqueue(parent, agent.id, "result", result);
        }
      })();
    } catch (error) {
      outcome = signal.aborted ? "aborted" : "error";
      agent.status =
        agent.kind === "main"
          ? "idle"
          : signal.aborted
            ? "cancelled"
            : "failed";
      agent.activity = error instanceof Error ? error.message : String(error);
      ctx?.failLastRunningStep(agent.activity);
      if (agent.kind === "main") {
        partial.content ||= `Error: ${agent.activity}`;
        closeSegment();
      } else if (!signal.aborted && agent.parentId) {
        const parent = this.store.get(agent.parentId);
        agent.endedAt = Date.now();
        getDb().transaction(() => {
          this.store.save(agent);
          if (parent && !this.deleting.has(agent.sessionId))
            this.enqueue(parent, agent.id, "failure", agent.activity);
        })();
      }
    } finally {
      // Stop may have set held while the model awaited I/O.
      agent.held = this.store.get(agent.id)?.held ?? agent.held;
      if (isFinalAgent(agent)) agent.endedAt = Date.now();
      this.status(agent);
      eventHub.publish(agent.ownerUuid, {
        type: "activation_ended",
        sessionId: agent.sessionId,
        agentId: agent.id,
        activationId: partial.id,
        outcome,
      });
    }
  }
  private tools(
    agent: AgentRecord,
    signal: AbortSignal,
    wait: () => void,
    activationModel: string,
  ): BaseTool[] {
    const message = new RuntimeTool(
      "send_message",
      "Send a message to your parent or a subagent. Progress does not wake the parent.",
      parameters(
        {
          to: { type: "string" },
          content: { type: "string" },
          kind: { type: "string" },
        },
        ["content"],
      ),
      async (args) => {
        const target = this.store.get(
          agent.kind === "main" ? text(args, "to") : (agent.parentId ?? ""),
        );
        if (
          !target ||
          target.ownerUuid !== agent.ownerUuid ||
          target.sessionId !== agent.sessionId ||
          (agent.kind === "main" && target.parentId !== agent.id)
        )
          throw new Error("Unknown recipient");
        if (args.kind !== undefined && args.kind !== "progress")
          throw new Error("Invalid message kind");
        this.enqueue(
          target,
          agent.id,
          args.kind === "progress" ? "progress" : "message",
          text(args, "content"),
        );
        if (args.kind === "progress") {
          agent.activity = text(args, "content");
          this.status(agent);
        }
        return { text: "Message sent" };
      },
    );
    if (agent.kind !== "main")
      return [
        message,
        new RuntimeTool(
          "ask_parent",
          "Ask the parent a question and wait for its answer.",
          parameters({ question: { type: "string" } }, ["question"]),
          async (args) => {
            const parent = this.store.get(agent.parentId ?? "");
            if (!parent) throw new Error("Parent unavailable");
            this.enqueue(parent, agent.id, "question", text(args, "question"));
            wait();
            return { text: "Waiting for parent", endActivation: true };
          },
        ),
      ];
    return [
      message,
      new RuntimeTool(
        "spawn_agent",
        "Start a durable general subagent. Include context and success criteria. It reports back when done, then stays ready: send_message wakes it with a follow-up and it keeps its context. Dismiss it with cancel_agent when it is no longer needed.",
        parameters(
          {
            kind: { type: "string" },
            title: { type: "string" },
            task: { type: "string" },
            wait: { type: "boolean" },
            model: { type: "string" },
          },
          ["kind", "title", "task"],
        ),
        async (args) => {
          if (args.kind !== "general")
            throw new Error("Only general agents are supported");
          if (
            this.store
              .list(agent.ownerUuid, agent.sessionId)
              .filter((a) => a.kind !== "main" && isWorkingAgent(a)).length >= 3
          )
            throw new Error("Three subagents are already working in this chat");
          const child: AgentRecord = {
            ...agent,
            id: crypto.randomUUID(),
            parentId: agent.id,
            kind: "general",
            title: text(args, "title"),
            status: "queued",
            model:
              typeof args.model === "string" ? args.model : activationModel,
            spawnPosition: (
              this.temporaryHistory.get(agent.sessionId) ??
              getMessagesForSession(agent.ownerUuid, agent.sessionId)
            ).length,
            createdAt: Date.now(),
            endedAt: null,
            history: [],
            partial: undefined,
            versions: undefined,
            checkpoints: {},
            steps: [],
            activity: text(args, "task"),
            held: false,
            wakes: 0,
          };
          this.store.save(child, this.temporaryHistory.has(agent.sessionId));
          this.status(child);
          this.enqueue(child, agent.id, "task", text(args, "task"));
          if (args.wait === true) {
            // A blocking caller releases its scheduler slot so the child can start.
            this.waitingForChild.add(agent.id);
            this.schedule();
            try {
              // A child that asks a question waits on this caller, so return
              // and let its question arrive through the inbox.
              await this.until(() => {
                const current = this.store.get(child.id);
                return (
                  !current ||
                  current.status === "waiting" ||
                  !isWorkingAgent(current)
                );
              }, signal);
              if (!signal.aborted) {
                const current = this.store.get(child.id);
                return {
                  text: JSON.stringify({
                    agentId: child.id,
                    status: current?.status,
                    result: current?.activity,
                  }),
                };
              }
            } finally {
              await this.until(
                () => this.runningCount(agent.ownerUuid) < 4,
                signal,
              );
              this.waitingForChild.delete(agent.id);
            }
          }
          return { text: JSON.stringify({ agentId: child.id }) };
        },
      ),
      new RuntimeTool(
        "cancel_agent",
        "Stop a working subagent, or dismiss a ready one you no longer need.",
        parameters(
          { agentId: { type: "string" }, reason: { type: "string" } },
          ["agentId", "reason"],
        ),
        async (args) => {
          const child = this.store.get(text(args, "agentId"));
          if (!child || child.parentId !== agent.id)
            throw new Error("Unknown subagent");
          await this.cancel(child, text(args, "reason"));
          return { text: "Cancelled" };
        },
      ),
    ];
  }
  private recordControl(agent: AgentRecord, content: string) {
    const message = this.store.enqueue({
      agentId: agent.id,
      sender: "runtime",
      kind: "control",
      content,
      wakes: false,
      attachmentIds: [],
    });
    this.store.deliver([message]);
  }
  async cancel(agent: AgentRecord, reason = "Stopped by user") {
    if (isFinalAgent(agent)) return;
    // Dismissing a ready subagent ends it as done rather than stopped.
    const ready = agent.status === "idle" && !this.active.has(agent.id);
    this.recordControl(agent, reason);
    if (agent.kind === "main")
      this.store.hold(this.store.inbox(agent.id), true);
    agent.held = true;
    this.store.save(agent);
    const active = this.active.get(agent.id);
    active?.controller.abort();
    await active?.promise;
    const current = this.store.get(agent.id);
    if (!current) return;
    current.status =
      agent.kind === "main" ? "idle" : ready ? "completed" : "cancelled";
    if (current.kind === "main") current.held = false;
    // A dismissed agent keeps its last result as its summary.
    if (!ready) current.activity = reason;
    if (current.kind !== "main") {
      current.endedAt = Date.now();
      this.store.deliver(
        this.store.inbox(current.id).filter((m) => m.deliveredAt === null),
      );
    }
    this.status(current);
    this.schedule();
  }
  deliver(agent: AgentRecord) {
    this.recordControl(agent, "Deliver held messages");
    agent.held = false;
    agent.wakes = 0;
    this.store.hold(this.store.inbox(agent.id), false);
    this.status(agent);
    this.schedule();
  }
  async deleteSession(owner: string, sessionId: string) {
    this.deleting.add(sessionId);
    try {
      for (const agent of this.store.list(owner, sessionId)) {
        await this.cancel(agent, "Chat deleted");
        this.store.remove(agent);
      }
      this.temporaryHistory.delete(sessionId);
    } finally {
      this.deleting.delete(sessionId);
    }
  }
  async rewind(
    owner: string,
    sessionId: string,
    request: {
      position: number;
      content?: string;
      versions?: WireMessageInput["versions"];
    },
    temporary = false,
  ) {
    const main = this.main(owner, sessionId, temporary);
    const history =
      this.temporaryHistory.get(sessionId) ??
      getMessagesForSession(owner, sessionId);
    const target = history[request.position];
    if (!target || target.role !== "user")
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "Rewind must target a user message",
      );
    if (this.isChanging(sessionId))
      throw new ApiError(
        409,
        "CONFLICT",
        "The conversation is already being changed",
      );
    this.rewinding.add(sessionId);
    const rewound = new Set<string>();
    let current = main;
    try {
      await this.cancel(main);
      for (const agent of this.store.list(owner, sessionId))
        if (agent.kind !== "main" && agent.spawnPosition >= request.position) {
          await this.cancel(agent, "Conversation rewound");
          rewound.add(agent.id);
          agent.spawnPosition = -1;
          this.status(agent);
        }
      const kept = history.slice(0, request.position);
      if (temporary)
        this.temporaryHistory.set(sessionId, kept as WireMessageInput[]);
      else
        getDb().run(
          "DELETE FROM messages WHERE session_id = ? AND position >= ?",
          [sessionId, request.position],
        );
      current = this.store.get(main.id)!;
      const checkpoint = current.checkpoints[String(request.position)];
      current.history =
        checkpoint === undefined
          ? kept
              .filter((m) => m.role !== "event")
              .map((m) => ({ role: m.role, content: m.content }))
          : current.history.slice(0, checkpoint);
      current.checkpoints = Object.fromEntries(
        Object.entries(current.checkpoints).filter(
          ([position]) => Number(position) < request.position,
        ),
      );
      current.versions = request.versions;
      // Drop queued user input and reports from rewound agents; reports from
      // agents that stay in the conversation are still owed to the model.
      this.store.deliver(
        this.store
          .inbox(main.id)
          .filter(
            (m) =>
              m.deliveredAt === null &&
              (m.kind === "user" || rewound.has(m.sender)),
          ),
      );
      this.saveHistory(current, current.history);
    } finally {
      this.rewinding.delete(sessionId);
    }
    this.resync(owner, sessionId);
    this.enqueue(
      current,
      "user",
      "user",
      request.content ?? target.content,
      target.attachments?.filter((a) => a.kind === "image").map((a) => a.id) ??
        [],
    );
  }
  recover() {
    for (const agent of this.store.list()) {
      if (agent.status !== "running") continue;
      const calls =
        agent.history.filter((m) => m.role === "assistant").at(-1)
          ?.tool_calls ?? [];
      for (const call of calls)
        if (
          call.id &&
          !agent.history.some(
            (m) => m.role === "tool" && m.tool_call_id === call.id,
          )
        )
          agent.history.push({
            role: "tool",
            tool_call_id: call.id,
            content:
              "Interrupted by a server restart. Check the current state before retrying.",
          });
      if (agent.kind === "main" && agent.partial) {
        this.append(agent, {
          ...agent.partial,
          content: `${agent.partial.content}

*Response interrupted by server restart.*`,
        });
        agent.partial = undefined;
      }
      agent.status = agent.kind === "main" ? "idle" : "queued";
      this.store.save(agent);
      if (agent.kind !== "main")
        this.enqueue(
          agent,
          "runtime",
          "message",
          "Resume after server restart. Check state before repeating side effects.",
        );
    }
    this.schedule();
  }
}
export const agentRuntime = new AgentRuntime();
