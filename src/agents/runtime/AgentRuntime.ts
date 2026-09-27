import { DEFAULT_RUN_MODEL } from "../../constants";
import { type AgentRecord, AgentStore } from "../../db/agents";
import {
  appendRuntimeMessage,
  getMessagesForSession,
  getSessionById,
  parseModelMessages,
  truncateSessionMessages,
} from "../../db/sessions";
import { type Unsequenced, eventHub } from "../../events/eventHub";
import { ApiError } from "../../http/errors";
import {
  type Agent,
  AgentSchema,
  type InboxMessage,
  type SendMessageRequest,
  WORKING_STATUSES,
  isFinalAgent,
  isWorkingAgent,
} from "../../schemas/agents";
import type { Activation } from "../../schemas/events";
import { ModelMessageSchema } from "../../schemas/modelMessages";
import type { WireMessageInput } from "../../schemas/run";
import type { BaseTool } from "../../tools/BaseTool";
import { AskParentTool } from "../../tools/ask_parent";
import { CancelAgentTool } from "../../tools/cancel_agent";
import {
  type AgentMessageRequest,
  SendMessageTool,
} from "../../tools/send_message";
import {
  SpawnAgentTool,
  type SpawnRequest,
  type SpawnResult,
} from "../../tools/spawn_agent";
import { RuntimeTransaction } from "./RuntimeTransaction";
import { runActivation } from "./activation";
import { agentEnvelope } from "./agentContext";

/** Activations one owner may run at once. */
const MAX_RUNNING_PER_OWNER = 4;
/** Running or waiting subagents admitted in one chat; queued work waits. */
const MAX_ACTIVE_SUBAGENTS = 3;
/** Model calls across a chat between user messages or explicit delivery. */
const MAX_AUTOMATIC_MODEL_CALLS = 10;

export class AgentRuntime {
  readonly store = new AgentStore();
  private active = new Map<
    string,
    { controller: AbortController; promise: Promise<void>; partial: Activation }
  >();
  private temporaryHistory = new Map<string, WireMessageInput[]>();
  private deleting = new Set<string>();
  private rewinding = new Set<string>();
  private transactions = new RuntimeTransaction();
  resync(owner: string, sessionId: string) {
    this.emit(owner, { type: "resync", sessionId, agentId: "" });
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
    this.transactions.defer(() => {
      for (const check of [...this.waiters]) check();
    });
  }
  private atomically(sessionId: string, write: () => void) {
    const restore = this.store.checkpoint(sessionId);
    const history = this.temporaryHistory.get(sessionId);
    const saved = history ? structuredClone(history) : undefined;
    this.transactions.run(write, () => {
      restore();
      if (saved) this.temporaryHistory.set(sessionId, saved);
      else this.temporaryHistory.delete(sessionId);
    });
  }
  private emit(owner: string, event: Unsequenced) {
    const snapshot = structuredClone(event);
    this.transactions.defer(() => eventHub.publish(owner, snapshot));
  }
  /** Drops a chat's cached records once no activation or change holds them. */
  private release(sessionId: string) {
    if (
      this.isChanging(sessionId) ||
      [...this.active.values()].some((a) => a.partial.sessionId === sessionId)
    )
      return;
    this.store.release(sessionId);
  }

  main(owner: string, sessionId: string, temporary = false): AgentRecord {
    queueMicrotask(() => this.release(sessionId));
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
      history: [],
      checkpoints: {},
      // Agents that ended before this chat's main agent existed need no summary.
      lastSummaryAt: Date.now(),
      held: false,
      modelCalls: 0,
      config: {},
    };
    this.store.save(agent, temporary);
    this.store.saveHistory(agent, ModelMessageSchema.array().parse(history));
    if (temporary) this.temporaryHistory.set(sessionId, []);
    return agent;
  }
  snapshot(owner: string, sessionId: string) {
    const agents = this.store.view(owner, sessionId);
    const main = agents.find((a) => a.kind === "main");
    return {
      sequence: eventHub.sequence(owner),
      agents,
      activation: main ? (this.active.get(main.id)?.partial ?? null) : null,
      queued: main
        ? this.store.undelivered(main.id).filter((m) => m.kind === "user")
        : [],
      held: main ? this.held(main) : false,
      history:
        this.temporaryHistory.get(sessionId) ??
        getMessagesForSession(owner, sessionId),
    };
  }
  busy(owner: string, sessionId: string) {
    return this.store
      .sessionsWithStatus(owner, WORKING_STATUSES)
      .has(sessionId);
  }
  /** Whether messages wait on the user to deliver them. */
  private held(agent: Pick<Agent, "id" | "held">) {
    return (
      (agent.held && this.store.hasWakingMessage(agent.id, false)) ||
      this.store.hasWakingMessage(agent.id, true)
    );
  }
  private status(agent: AgentRecord) {
    this.store.save(agent);
    this.notify();
    this.emit(agent.ownerUuid, {
      type: "agent_status",
      sessionId: agent.sessionId,
      agentId: agent.id,
      agent: AgentSchema.parse({ ...agent, held: this.held(agent) }),
    });
  }
  /** Queues the user's message for the main agent with the settings sent with it. */
  send(record: AgentRecord, request: SendMessageRequest) {
    const main = this.store.get(record.id) ?? record;
    if (request.model) main.model = request.model;
    main.config = {
      metadata: request.metadata,
      reasoningEffort: request.reasoningEffort,
    };
    const queued = main.status === "running";
    const message = this.enqueue(
      main,
      "user",
      "user",
      request.content,
      request.attachmentIds,
    );
    return { message, queued };
  }
  enqueue(
    record: AgentRecord,
    sender: string,
    kind: InboxMessage["kind"],
    content: string,
    attachmentIds: string[] = [],
  ) {
    const agent = this.store.get(record.id);
    if (!agent || isFinalAgent(agent) || this.deleting.has(agent.sessionId))
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
      this.resetBudget(agent);
      this.store.save(agent);
    }
    this.emit(agent.ownerUuid, {
      type: "inbox_queued",
      sessionId: agent.sessionId,
      agentId: agent.id,
      messages: [message],
    });
    if (agent.held) this.status(agent);
    this.notify();
    this.transactions.defer(() => this.schedule());
    return message;
  }
  private budgetOwner(agent: AgentRecord) {
    const main =
      agent.kind === "main" ? agent : this.store.get(agent.parentId ?? "");
    if (!main) throw new Error("Parent unavailable");
    return main;
  }
  private resetBudget(main: AgentRecord) {
    main.modelCalls = 0;
    for (const agent of this.store.list(main.ownerUuid, main.sessionId)) {
      if (isFinalAgent(agent)) continue;
      agent.held = false;
      this.store.hold(agent.id, false);
      this.status(agent);
    }
  }
  /** Keep a continuation in the inbox, including when only tool history remains. */
  private pauseForBudget(agent: AgentRecord, main: AgentRecord) {
    for (const target of new Set([agent, main])) {
      target.held = true;
      if (!this.active.has(target.id)) target.status = "idle";
      if (!this.store.undelivered(target.id).some((m) => m.wakes))
        this.enqueue(
          target,
          "runtime",
          "message",
          "Automatic work paused at the model-call limit. Continue from saved context when the user resumes.",
        );
      this.status(target);
    }
  }
  private allowModelCall(agent: AgentRecord): boolean {
    const main = this.budgetOwner(agent);
    if (
      agent.kind === "main" &&
      this.store.undelivered(agent.id).some((m) => m.kind === "user" && !m.held)
    )
      return true;
    if (main.modelCalls >= MAX_AUTOMATIC_MODEL_CALLS) {
      this.pauseForBudget(agent, main);
      return false;
    }
    main.modelCalls++;
    this.store.save(main);
    return true;
  }
  removeQueued(record: AgentRecord, messageId: number): boolean {
    const agent = this.store.get(record.id) ?? record;
    let removed = false;
    this.atomically(agent.sessionId, () => {
      removed = this.store.removeQueued(agent.id, messageId);
      if (!removed) return;
      if (
        agent.status === "queued" &&
        !this.active.has(agent.id) &&
        !this.store.hasWakingMessage(agent.id, false)
      ) {
        agent.status = "idle";
        this.status(agent);
      }
      this.resync(agent.ownerUuid, agent.sessionId);
      this.transactions.defer(() => this.schedule());
    });
    return removed;
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
    for (const id of this.store.pendingAgentIds()) {
      const agent = this.store.get(id);
      if (
        !agent ||
        this.active.has(id) ||
        isFinalAgent(agent) ||
        agent.held ||
        this.isChanging(agent.sessionId)
      )
        continue;
      const main = this.budgetOwner(agent);
      const userInput =
        agent.kind === "main" &&
        this.store
          .undelivered(agent.id)
          .some((m) => m.kind === "user" && !m.held);
      if (main.modelCalls >= MAX_AUTOMATIC_MODEL_CALLS && !userInput) {
        this.atomically(agent.sessionId, () =>
          this.pauseForBudget(agent, main),
        );
        continue;
      }
      const children = this.store.list(agent.ownerUuid, agent.sessionId);
      const childSlotUnavailable =
        agent.kind !== "main" &&
        agent.status !== "waiting" &&
        children.filter(
          (child) =>
            child.kind !== "main" &&
            (child.status === "waiting" || this.active.has(child.id)),
        ).length >= MAX_ACTIVE_SUBAGENTS;
      if (
        childSlotUnavailable ||
        this.runningCount(agent.ownerUuid) >= MAX_RUNNING_PER_OWNER
      ) {
        // A waiting child already owns a child slot, even while awaiting an owner slot.
        if (agent.status !== "queued" && agent.status !== "waiting") {
          agent.status = "queued";
          this.status(agent);
        }
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
          this.release(agent.sessionId);
          this.notify();
          this.schedule();
        });
      this.active.set(agent.id, { controller, promise, partial });
    }
    for (const sessionId of this.store.cachedSessions())
      this.release(sessionId);
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
    this.emit(agent.ownerUuid, {
      type: "transcript_appended",
      sessionId: agent.sessionId,
      agentId: agent.id,
      message,
    });
  }
  private activate(
    agent: AgentRecord,
    signal: AbortSignal,
    partial: Activation,
  ) {
    return runActivation(
      {
        store: this.store,
        temporaryHistory: this.temporaryHistory,
        status: (record) => this.status(record),
        emit: (owner, event) => this.emit(owner, event),
        append: (record, message) => this.append(record, message),
        atomically: (sessionId, write) => this.atomically(sessionId, write),
        isDeleting: (sessionId) => this.deleting.has(sessionId),
        allowModelCall: (record) => this.allowModelCall(record),
        tools: (record, abort, wait, model) =>
          this.tools(record, abort, wait, model),
        enqueue: (record, sender, kind, content) =>
          this.enqueue(record, sender, kind, content),
      },
      agent,
      signal,
      partial,
    );
  }
  private tools(
    agent: AgentRecord,
    signal: AbortSignal,
    wait: () => void,
    activationModel: string,
  ): BaseTool[] {
    const message = new SendMessageTool((request) =>
      this.sendMessage(agent, request),
    );
    if (agent.kind !== "main")
      return [
        message,
        new AskParentTool((question) => {
          const parent = this.store.get(agent.parentId ?? "");
          if (!parent) throw new Error("Parent unavailable");
          this.enqueue(parent, agent.id, "question", question);
          wait();
        }),
      ];
    return [
      message,
      new SpawnAgentTool((request) =>
        this.spawn(agent, request, activationModel, signal),
      ),
      new CancelAgentTool(async (agentId, reason) => {
        const child = this.store.get(agentId);
        if (!child || child.parentId !== agent.id)
          throw new Error("Unknown subagent");
        await this.cancel(child, reason);
      }),
    ];
  }
  private sendMessage(
    agent: AgentRecord,
    { to, content, kind }: AgentMessageRequest,
  ) {
    const target = this.store.get(
      agent.kind === "main" ? (to ?? "") : (agent.parentId ?? ""),
    );
    if (
      !target ||
      target.ownerUuid !== agent.ownerUuid ||
      target.sessionId !== agent.sessionId ||
      (agent.kind === "main" && target.parentId !== agent.id)
    )
      throw new Error("Unknown recipient");
    this.enqueue(target, agent.id, kind ?? "message", content);
    if (kind === "progress") {
      agent.activity = content;
      this.status(agent);
    }
  }
  private async spawn(
    parent: AgentRecord,
    request: SpawnRequest,
    model: string,
    signal: AbortSignal,
  ): Promise<SpawnResult> {
    const child: AgentRecord = {
      ...parent,
      id: crypto.randomUUID(),
      parentId: parent.id,
      kind: request.kind,
      title: request.title,
      status: "queued",
      model,
      spawnPosition: (
        this.temporaryHistory.get(parent.sessionId) ??
        getMessagesForSession(parent.ownerUuid, parent.sessionId)
      ).length,
      createdAt: Date.now(),
      endedAt: null,
      history: [],
      partial: undefined,
      versions: undefined,
      checkpoints: {},
      steps: [],
      activity: request.prompt,
      held: false,
      modelCalls: 0,
    };
    this.atomically(parent.sessionId, () => {
      this.store.save(child, this.temporaryHistory.has(parent.sessionId));
      this.status(child);
      this.enqueue(child, parent.id, "task", request.prompt);
    });
    if (!request.wait) return { agentId: child.id };
    // A blocking caller releases its scheduler slot so the child can start.
    this.waitingForChild.add(parent.id);
    this.schedule();
    try {
      // Return for incoming input or a child waiting on Euler, including
      // other children that occupy the slots this new child needs.
      await this.until(() => {
        const current = this.store.get(child.id);
        return (
          !current ||
          current.status === "waiting" ||
          !isWorkingAgent(current) ||
          this.store.hasWakingMessage(parent.id, false) ||
          (current.status === "queued" &&
            this.store
              .list(parent.ownerUuid, parent.sessionId)
              .some(
                (peer) => peer.kind !== "main" && peer.status === "waiting",
              ))
        );
      }, signal);
      if (signal.aborted) return { agentId: child.id };
      const current = this.store.get(child.id);
      return {
        agentId: child.id,
        status: current?.status,
        result: current?.activity,
      };
    } finally {
      await this.until(() => {
        if (this.runningCount(parent.ownerUuid) >= MAX_RUNNING_PER_OWNER)
          return false;
        // Claim the slot before another waiter checks availability.
        this.waitingForChild.delete(parent.id);
        return true;
      }, signal);
      this.waitingForChild.delete(parent.id);
    }
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
  async cancel(record: AgentRecord, reason = "Stopped by user") {
    const agent = this.store.get(record.id) ?? record;
    if (isFinalAgent(agent)) return;
    // Dismissing a ready subagent ends it as done rather than stopped.
    const ready = agent.status === "idle" && !this.active.has(agent.id);
    this.recordControl(agent, reason);
    if (agent.kind === "main") this.store.hold(agent.id, true);
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
      this.store.deliver(this.store.undelivered(current.id));
    }
    this.status(current);
    this.schedule();
    this.release(current.sessionId);
  }
  deliver(record: AgentRecord) {
    const agent = this.store.get(record.id) ?? record;
    this.recordControl(agent, "Deliver held messages");
    this.resetBudget(agent);
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
    try {
      await this.cancel(main);
      const rewound = new Set<string>();
      for (const agent of this.store.list(owner, sessionId))
        if (agent.kind !== "main" && agent.spawnPosition >= request.position) {
          await this.cancel(agent, "Conversation rewound");
          rewound.add(agent.id);
          agent.spawnPosition = -1;
          this.status(agent);
        }
      const kept = history.slice(0, request.position);
      const current = this.store.get(main.id)!;
      const checkpoint = current.checkpoints[String(request.position)];
      // The transcript, model history, and inbox change together or not at all.
      this.atomically(sessionId, () => {
        if (temporary)
          this.temporaryHistory.set(sessionId, kept as WireMessageInput[]);
        else truncateSessionMessages(sessionId, request.position);
        this.store.saveHistory(
          current,
          checkpoint === undefined
            ? kept
                .filter((m) => m.role !== "event")
                .map((m) => ({ role: m.role, content: m.content }))
            : current.history.slice(0, checkpoint),
        );
        current.checkpoints = Object.fromEntries(
          Object.entries(current.checkpoints).filter(
            ([position]) => Number(position) < request.position,
          ),
        );
        current.versions = request.versions;
        this.store.save(current);
        // Drop queued user input and reports from rewound agents; reports from
        // agents that stay in the conversation are still owed to the model.
        this.store.deliver(
          this.store
            .undelivered(main.id)
            .filter((m) => m.kind === "user" || rewound.has(m.sender)),
        );
        this.resync(owner, sessionId);
        this.enqueue(
          current,
          "user",
          "user",
          request.content ?? target.content,
          target.attachments
            ?.filter((a) => a.kind === "image")
            .map((a) => a.id) ?? [],
        );
      });
    } finally {
      this.rewinding.delete(sessionId);
      this.release(sessionId);
    }
  }
  recover() {
    const agents = ["running", "queued", "waiting", "idle"] as const;
    for (const agent of agents.flatMap((status) =>
      this.store.withStatus(status),
    )) {
      const pending = this.store.undelivered(agent.id);
      if (
        agent.status === "idle" &&
        !pending.length &&
        (agent.kind !== "main" || !agent.partial)
      )
        continue;
      this.atomically(agent.sessionId, () => {
        const history = [...agent.history];
        const calls =
          history.findLast((m) => m.role === "assistant")?.tool_calls ?? [];
        for (const call of calls) {
          if (
            call.id &&
            !history.some(
              (m) => m.role === "tool" && m.tool_call_id === call.id,
            )
          )
            history.push({
              role: "tool",
              tool_call_id: call.id,
              content:
                "Interrupted by a server restart. Check the current state before retrying.",
            });
        }
        if (agent.kind === "main") {
          if (agent.partial)
            this.append(agent, {
              ...agent.partial,
              content: `${agent.partial.content}\n\n*Response interrupted by server restart.*`,
            });
          // Nothing starts solely because the server restarted.
          this.store.hold(agent.id, true);
        } else {
          const peers = this.store.list(agent.ownerUuid, agent.sessionId);
          for (const message of pending)
            history.push({
              role: "user",
              content: agentEnvelope(message, peers),
            });
          this.store.deliver(pending);
          agent.activity =
            "Interrupted by server restart. Ready for new instructions.";
          history.push({ role: "user", content: agent.activity });
        }
        agent.partial = undefined;
        agent.status = "idle";
        agent.held = false;
        this.store.saveHistory(agent, history);
        this.status(agent);
      });
      this.release(agent.sessionId);
    }
  }
}
export const agentRuntime = new AgentRuntime();
