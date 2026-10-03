import type { OutputAttachment } from "../../attachments/types";
import { DEFAULT_RUN_MODEL } from "../../constants";
import { MAIN_AGENT_TITLE, createAgentRecord } from "../../db/agentRecord";
import { type AgentRecord, AgentStore } from "../../db/agents";
import {
  appendRuntimeMessage,
  countMessagesForSession,
  getMessagesForSession,
  getSessionById,
  patchSessionRow,
  truncateSessionMessages,
} from "../../db/sessions";
import { envConfig } from "../../env";
import { type Unsequenced, eventHub } from "../../events/eventHub";
import { JobManager } from "../../jobs/JobManager";
import { OperationError } from "../../observability/errors";
import { logEvent, withBackgroundLogContext } from "../../observability/logger";
import {
  type InboxMessage,
  type RewindRequest,
  type SendMessageRequest,
  type TurnSettings,
  WORKING_STATUSES,
  isFinalAgent,
  isWorkingAgent,
} from "../../schemas/agents";
import type { Activation } from "../../schemas/events";
import type { WireMessageInput } from "../../schemas/run";
import type { BaseTool } from "../../tools/BaseTool";
import { AskParentTool } from "../../tools/ask_parent";
import { CancelAgentTool } from "../../tools/cancel_agent";
import { JobTool } from "../../tools/jobs";
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
import { recoverInterrupted } from "./recovery";

/** Running or waiting subagents admitted in one chat; queued work waits. */
const MAX_ACTIVE_SUBAGENTS = 3;
/**
 * Deliveries of agent or runtime messages across a chat between user messages
 * or explicit delivery. Tool continuations are not counted: the budget bounds
 * agents waking each other, not how long one activation works.
 */
const MAX_AUTOMATIC_TURNS = 10;
/** Held for a paused agent, so Deliver is offered even with nothing else pending. */
const PAUSE_NOTE =
  "Automatic work paused at the automatic-turn limit. Continue from saved context when the user resumes.";

export class AgentRuntime {
  constructor(
    /** Activations one owner may run at once, across all chats. */
    private readonly maxRunningPerOwner = envConfig.maxRunningAgents,
  ) {}
  readonly store = new AgentStore();
  readonly jobs = new JobManager({
    position: (id) => this.transcriptLength(id),
    blocked: (id) => this.isChanging(id),
    changed: (job) => this.resync(job.ownerUuid, job.sessionId),
    notify: (job, wakes) => {
      const agent = this.store.get(job.agentId);
      if (!agent || isFinalAgent(agent)) return;
      this.atomically(job.sessionId, () => {
        if (!wakes) {
          this.store.enqueue({
            agentId: agent.id,
            sender: "runtime",
            kind: "job",
            content: JSON.stringify({
              jobId: job.id,
              status: job.status,
              error: job.error,
            }),
            wakes: false,
            attachmentIds: [],
            attachments: [],
          });
          return;
        }
        this.enqueue(
          agent,
          "runtime",
          "job",
          JSON.stringify({
            jobId: job.id,
            tool: job.tool,
            status: job.status,
            result: job.result,
            error: job.error,
          }),
          [],
          job.result?.attachments,
        );
        if (this.stopping.has(agent.id) || this.store.isHeld(agent.id))
          this.store.hold(agent.id, true);
      });
    },
  });
  private active = new Map<
    string,
    { controller: AbortController; promise: Promise<void>; partial: Activation }
  >();
  private deleting = new Set<string>();
  private rewinding = new Set<string>();
  /** Agents being cancelled, which must not start again before it settles. */
  private stopping = new Set<string>();
  private transactions = new RuntimeTransaction();
  private scheduled = false;
  private waitingForChild = new Set<string>();
  private waiters = new Set<() => void>();
  resync(owner: string, sessionId: string) {
    this.emit(owner, { type: "resync", sessionId, agentId: "" });
  }
  /** The current record: one may be released and reloaded across awaits. */
  private live(record: AgentRecord) {
    return this.store.get(record.id) ?? record;
  }
  isChanging(sessionId: string) {
    return this.deleting.has(sessionId) || this.rewinding.has(sessionId);
  }
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
  private atomically<T>(sessionId: string, write: () => T): T {
    return this.transactions.run(write, this.store.checkpoint(sessionId));
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

  main(owner: string, sessionId: string): AgentRecord {
    // Its agents are gone, so one must not be created for a chat being deleted.
    if (this.deleting.has(sessionId))
      throw new OperationError("CONFLICT", {
        message: "The conversation is being deleted",
      });
    queueMicrotask(() => this.release(sessionId));
    const existing = this.store
      .list(owner, sessionId)
      .find((a) => a.kind === "main");
    if (existing) return existing;
    const session = getSessionById(owner, sessionId);
    if (!session) throw new Error("Session not found");
    const agent = createAgentRecord({
      ownerUuid: owner,
      sessionId,
      parentId: null,
      kind: "main",
      title: MAIN_AGENT_TITLE,
      status: "idle",
      model: session.model ?? DEFAULT_RUN_MODEL,
      spawnPosition: 0,
      activity: "",
      config: {},
    });
    this.store.save(agent);
    return agent;
  }
  snapshot(owner: string, sessionId: string) {
    const agents = this.store.view(owner, sessionId);
    const main = agents.find((a) => a.kind === "main");
    return {
      sequence: eventHub.sequence(owner),
      agents,
      jobs: this.jobs.list(owner, sessionId),
      activation: main ? (this.active.get(main.id)?.partial ?? null) : null,
      queued: main
        ? this.store.undelivered(main.id).filter((m) => m.kind === "user")
        : [],
      held: main ? this.store.isHeld(main.id) : false,
      history: getMessagesForSession(owner, sessionId),
    };
  }
  busy(owner: string, sessionId: string) {
    return (
      this.jobs.busy(owner, sessionId) ||
      this.store.sessionsWithStatus(owner, WORKING_STATUSES).has(sessionId)
    );
  }
  private status(agent: AgentRecord) {
    this.store.save(agent);
    this.notify();
    this.emit(agent.ownerUuid, {
      type: "agent_status",
      sessionId: agent.sessionId,
      agentId: agent.id,
      agent: this.store.present(agent),
    });
  }
  /** Queues the user's message for the main agent with the settings sent with it. */
  send(record: AgentRecord, request: SendMessageRequest) {
    const main = this.live(record);
    return this.atomically(main.sessionId, () => {
      this.configure(main, request);
      const queued = main.status === "running";
      const message = this.enqueue(
        main,
        "user",
        "user",
        request.content,
        request.attachmentIds,
      );
      return { message, queued };
    });
  }
  /** Applies the composer settings a user turn was sent with. */
  private configure(main: AgentRecord, settings: TurnSettings) {
    if (settings.model) {
      main.model = settings.model;
      patchSessionRow(main.ownerUuid, main.sessionId, { model: main.model });
    }
    main.config = {
      metadata: settings.metadata,
      reasoningEffort: settings.reasoningEffort,
    };
  }
  enqueue(
    record: AgentRecord,
    sender: string,
    kind: InboxMessage["kind"],
    content: string,
    attachmentIds: string[] = [],
    attachments: OutputAttachment[] = [],
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
      attachments,
      wakes: kind !== "progress",
    });
    if (kind === "user") this.resetBudget(agent);
    this.emit(agent.ownerUuid, {
      type: "inbox_queued",
      sessionId: agent.sessionId,
      agentId: agent.id,
      messages: [message],
    });
    this.notify();
    this.transactions.defer(() => this.schedule());
    return message;
  }
  private budgetOwner(agent: AgentRecord) {
    return agent.kind === "main" ? agent : this.store.get(agent.parentId ?? "");
  }
  /** Whether the agent's next delivery is agent or runtime work, not user input. */
  private deliversAutomaticWork(agent: AgentRecord) {
    const pending = this.store.undelivered(agent.id).filter((m) => !m.held);
    return (
      pending.some((m) => m.wakes) && !pending.some((m) => m.kind === "user")
    );
  }
  /** Resets the chat's automatic turns and releases every held message. */
  private resetBudget(main: AgentRecord) {
    main.automaticTurns = 0;
    this.store.save(main);
    for (const agent of this.store.list(main.ownerUuid, main.sessionId)) {
      if (isFinalAgent(agent)) continue;
      const held = this.store.isHeld(agent.id);
      this.store.hold(agent.id, false);
      if (held) this.status(agent);
    }
  }
  /**
   * Holds the agent's pending messages and the main agent's. A main agent with
   * nothing pending gets a note, so Deliver is offered when only a child paused.
   * Messages that arrive later are held by the scheduler's budget check.
   */
  private pauseForBudget(agent: AgentRecord, main: AgentRecord) {
    for (const target of new Set([agent, main])) {
      if (!this.active.has(target.id)) target.status = "idle";
      if (!this.store.undelivered(target.id).some((m) => m.wakes))
        this.enqueue(target, "runtime", "message", PAUSE_NOTE);
      this.store.hold(target.id, true);
      this.status(target);
    }
  }
  private allowModelCall(agent: AgentRecord): boolean {
    if (!this.deliversAutomaticWork(agent)) return true;
    const main = this.budgetOwner(agent);
    if (!main) throw new Error("Parent unavailable");
    if (main.automaticTurns >= MAX_AUTOMATIC_TURNS) {
      this.pauseForBudget(agent, main);
      return false;
    }
    main.automaticTurns++;
    this.store.save(main);
    return true;
  }
  removeQueued(record: AgentRecord, messageId: number): boolean {
    const agent = this.live(record);
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
      try {
        this.pump();
      } catch (error) {
        logEvent("error", "agent.schedule_failed", {}, error);
      }
    });
  }
  private pump() {
    for (const id of this.store.pendingAgentIds()) {
      const agent = this.store.get(id);
      if (
        !agent ||
        this.active.has(id) ||
        this.stopping.has(id) ||
        isFinalAgent(agent) ||
        this.isChanging(agent.sessionId)
      )
        continue;
      const main = this.budgetOwner(agent);
      if (!main) continue;
      if (
        main.automaticTurns >= MAX_AUTOMATIC_TURNS &&
        this.deliversAutomaticWork(agent)
      ) {
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
        this.runningCount(agent.ownerUuid) >= this.maxRunningPerOwner
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
      const run = () =>
        withBackgroundLogContext(
          {
            sessionId: agent.sessionId,
            agentId: agent.id,
            activationId: partial.id,
          },
          async () => {
            try {
              await this.activate(agent, controller.signal, partial);
            } catch (error) {
              this.contain(agent, error);
            } finally {
              this.active.delete(agent.id);
              this.release(agent.sessionId);
              this.notify();
              this.schedule();
            }
          },
        );
      // Install the lock before activation starts, including workspace resolution.
      const promise = Promise.resolve()
        .then(run)
        .catch((error) =>
          logEvent("error", "agent.schedule_failed", {}, error),
        );
      this.active.set(agent.id, { controller, promise, partial });
    }
    for (const sessionId of this.store.cachedSessions())
      this.release(sessionId);
  }
  /**
   * An activation records its own errors, so one escaping it means recording
   * failed, such as a database error. It must not stop the runtime.
   */
  private contain(record: AgentRecord, error: unknown) {
    logEvent("error", "activation.unrecorded", {}, error);
    // Clients may have missed the activation's end, so they reload its chat.
    this.resync(record.ownerUuid, record.sessionId);
    try {
      const agent = this.store.get(record.id);
      if (!agent || !isWorkingAgent(agent)) return;
      agent.status = "idle";
      agent.interruption =
        error instanceof Error ? error.message : String(error);
      this.status(agent);
    } catch (followup) {
      logEvent("error", "activation.containment_failed", {}, followup);
    }
  }
  /** The number of transcript messages, without loading them. */
  private transcriptLength(sessionId: string) {
    return countMessagesForSession(sessionId);
  }
  private append(agent: AgentRecord, message: WireMessageInput) {
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
        jobs: this.jobs,
        status: (record) => this.status(record),
        emit: (owner, event) => this.emit(owner, event),
        append: (record, message) => this.append(record, message),
        atomically: (sessionId, write) => this.atomically(sessionId, write),
        isDeleting: (sessionId) => this.deleting.has(sessionId),
        transcriptLength: (sessionId) => this.transcriptLength(sessionId),
        allowModelCall: (record) => this.allowModelCall(record),
        tools: (record, abort, wait, model) =>
          this.tools(record, abort, wait, model),
        enqueue: (record, sender, kind, content, attachments) =>
          this.enqueue(record, sender, kind, content, [], attachments),
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
    currentModel: () => string,
  ): BaseTool[] {
    const authorizeJob = (jobId: string) => {
      const job = this.jobs.read(agent.ownerUuid, agent.sessionId, jobId);
      let owner = this.store.get(job.agentId);
      while (owner && owner.id !== agent.id)
        owner = owner.parentId ? this.store.get(owner.parentId) : undefined;
      if (!owner) throw new Error("Unknown job");
    };
    const jobTools = [
      new JobTool("get_job", (id) => {
        authorizeJob(id);
        return this.jobs.read(agent.ownerUuid, agent.sessionId, id);
      }),
      new JobTool("cancel_job", async (id) => {
        authorizeJob(id);
        return this.jobs.cancel(agent.ownerUuid, agent.sessionId, id);
      }),
    ];
    const message = new SendMessageTool(
      (request) => this.sendMessage(agent, request),
      agent.kind !== "main",
    );
    if (agent.kind !== "main")
      return [
        ...jobTools,
        message,
        new AskParentTool((question) => {
          const parent = this.store.get(agent.parentId ?? "");
          if (!parent) throw new Error("Parent unavailable");
          this.enqueue(parent, agent.id, "question", question);
          wait();
        }),
      ];
    return [
      ...jobTools,
      message,
      new SpawnAgentTool((request) =>
        this.spawn(agent, request, currentModel(), signal),
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
    // A subagent's parent, or a child the main agent spawned, shares its chat.
    if (!target || (agent.kind === "main" && target.parentId !== agent.id))
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
    const child = createAgentRecord({
      ownerUuid: parent.ownerUuid,
      sessionId: parent.sessionId,
      parentId: parent.id,
      kind: request.kind,
      title: request.title,
      status: "queued",
      model,
      spawnPosition: this.transcriptLength(parent.sessionId),
      activity: request.prompt,
      config: parent.config,
    });
    this.atomically(parent.sessionId, () => {
      this.store.save(child);
      this.status(child);
      this.enqueue(child, parent.id, "task", request.prompt);
    });
    if (!request.wait) return { agentId: child.id };
    // A blocking caller releases its scheduler slot so the child can start.
    this.waitingForChild.add(parent.id);
    this.schedule();
    try {
      // Return for incoming input or a child waiting on the parent, including
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
      const current = this.store.get(child.id);
      if (signal.aborted || !current) return { agentId: child.id };
      // Its activity is not a result yet: it may still be the prompt.
      if (isWorkingAgent(current))
        return {
          agentId: child.id,
          status: current.status,
          note: "Still working. Its questions and result arrive as messages.",
        };
      const report = this.receiveReport(parent, child.id);
      return {
        agentId: child.id,
        status: current.status,
        ...(report?.kind === "failure"
          ? { error: report.content }
          : { result: current.activity }),
      };
    } finally {
      await this.until(() => {
        if (this.runningCount(parent.ownerUuid) >= this.maxRunningPerOwner)
          return false;
        // Claim the slot before another waiter checks availability.
        this.waitingForChild.delete(parent.id);
        return true;
      }, signal);
      this.waitingForChild.delete(parent.id);
    }
  }
  /** A blocking spawn returns the child's report, so it is not delivered again. */
  private receiveReport(record: AgentRecord, childId: string) {
    const parent = this.live(record);
    return this.atomically(parent.sessionId, () => {
      const reports = this.store
        .undelivered(parent.id)
        .filter(
          (m) =>
            m.sender === childId &&
            (m.kind === "result" || m.kind === "failure"),
        );
      for (const report of reports)
        parent.pendingOutputs.push(...report.attachments);
      this.store.deliver(reports);
      this.store.save(parent);
      return reports.at(-1);
    });
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
  async cancel(record: AgentRecord, requestedReason?: string) {
    const agent = this.live(record);
    if (isFinalAgent(agent)) return;
    // Dismissing a ready subagent ends it as done rather than stopped.
    const ready = agent.status === "idle" && !this.active.has(agent.id);
    const reason =
      requestedReason ?? (ready ? "Dismissed by user" : "Stopped by user");
    this.recordControl(agent, reason);
    // Input already queued waits for Deliver; a subagent's is dropped below.
    this.store.hold(agent.id, true);
    this.stopping.add(agent.id);
    try {
      const active = this.active.get(agent.id);
      active?.controller.abort();
      await active?.promise;
      await this.jobs.cancelAgent(agent.ownerUuid, agent.sessionId, agent.id);
    } finally {
      this.stopping.delete(agent.id);
    }
    const current = this.store.get(agent.id);
    if (!current) return;
    current.interruption = undefined;
    current.status =
      agent.kind === "main" ? "idle" : ready ? "completed" : "cancelled";
    // A dismissed agent keeps its last result as its summary.
    if (!ready) current.activity = reason;
    if (current.kind !== "main") {
      current.endedAt = Date.now();
      this.store.deliver(this.store.undelivered(current.id));
      // Nobody is left to receive an answer to its question.
      this.store.deliver(
        this.store
          .undelivered(current.parentId ?? "")
          .filter((m) => m.sender === current.id && m.kind === "question"),
      );
      const parent = this.store.get(current.parentId ?? "");
      if (parent) this.withdrawPauseNote(parent);
    }
    this.status(current);
    this.schedule();
    this.release(current.sessionId);
  }
  /** With no paused subagent left, the parent's pause note offers Deliver for nothing. */
  private withdrawPauseNote(parent: AgentRecord) {
    if (
      this.store
        .list(parent.ownerUuid, parent.sessionId)
        .some(
          (a) =>
            a.kind !== "main" && !isFinalAgent(a) && this.store.isHeld(a.id),
        )
    )
      return;
    const notes = this.store
      .undelivered(parent.id)
      .filter((m) => m.sender === "runtime" && m.content === PAUSE_NOTE);
    if (!notes.length) return;
    this.store.deliver(notes);
    this.status(parent);
  }
  deliver(record: AgentRecord) {
    const agent = this.live(record);
    this.recordControl(agent, "Deliver held messages");
    this.resetBudget(agent);
    this.schedule();
  }
  /**
   * Cancels and removes the chat's agents, then runs `remove`, which deletes
   * the chat itself, before anything can start in the chat again.
   */
  async deleteSession<T>(
    owner: string,
    sessionId: string,
    remove?: () => Promise<T>,
  ): Promise<T | undefined> {
    this.deleting.add(sessionId);
    try {
      for (const agent of this.store.list(owner, sessionId)) {
        await this.cancel(agent, "Chat deleted");
        this.store.remove(agent);
      }
      this.jobs.remove(owner, sessionId);
      return await remove?.();
    } finally {
      this.deleting.delete(sessionId);
    }
  }
  async rewind(owner: string, sessionId: string, request: RewindRequest) {
    const main = this.main(owner, sessionId);
    const history = getMessagesForSession(owner, sessionId);
    const target = history[request.position];
    if (!target || target.role !== "user")
      throw new OperationError("INVALID_REQUEST", {
        message: "Rewind must target a user message",
      });
    if (this.isChanging(sessionId))
      throw new OperationError("CONFLICT", {
        message: "The conversation is already being changed",
      });
    this.rewinding.add(sessionId);
    try {
      await this.jobs.cancelAgent(owner, sessionId);
      await this.cancel(main);
      const rewound = new Set<string>();
      for (const agent of this.store.list(owner, sessionId))
        if (agent.kind !== "main" && agent.spawnPosition >= request.position) {
          await this.cancel(agent, "Conversation rewound");
          rewound.add(agent.id);
        }
      const kept = history.slice(0, request.position);
      const current = this.store.get(main.id)!;
      const checkpoint = current.checkpoints[String(request.position)];
      // The transcript, model history, and inbox change together or not at all.
      this.atomically(sessionId, () => {
        truncateSessionMessages(sessionId, request.position);
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
        current.pendingOutputs = [];
        current.versions = request.versions;
        // The summaries the model saw may be gone, so the next one is sent.
        current.lastSummary = "";
        this.configure(current, request);
        this.store.save(current);
        // Drop queued user input and reports from rewound agents; reports from
        // agents that stay in the conversation are still owed to the model.
        this.store.deliver(
          this.store
            .undelivered(main.id)
            .filter((m) => m.kind === "user" || rewound.has(m.sender)),
        );
        for (const id of rewound) {
          const agent = this.store.get(id);
          if (agent) this.store.remove(agent);
        }
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
    this.jobs.recover();
    recoverInterrupted({
      store: this.store,
      status: (agent) => this.status(agent),
      append: (agent, message) => this.append(agent, message),
      atomically: (sessionId, write) => this.atomically(sessionId, write),
      release: (sessionId) => this.release(sessionId),
    });
  }
}
export const agentRuntime = new AgentRuntime();
