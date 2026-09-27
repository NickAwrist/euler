import { z } from "zod";
import {
  type ImageAttachment,
  ImageAttachmentSchema,
  OutputAttachmentSchema,
} from "../attachments/types";
import type { LlmMessage } from "../llm";
import {
  type Agent,
  AgentSchema,
  type AgentStatus,
  type InboxMessage,
  InboxMessageSchema,
} from "../schemas/agents";
import { ModelMessageSchema } from "../schemas/modelMessages";
import {
  MessageVersionSchema,
  RunMetadataSchema,
  WireStepSchema,
} from "../schemas/run";
import { getDb, transaction } from "./connection";

/** `held` is derived from held messages, so records do not store it. */
const RecordSchema = AgentSchema.omit({ held: true }).extend({
  history: z.array(ModelMessageSchema),
  pendingOutputs: z.array(OutputAttachmentSchema).default([]),
  lastSummaryAt: z.number().default(0),
  /** The last `background_agents` summary the main agent's model received. */
  lastSummary: z.string().default(""),
  checkpoints: z.record(z.string(), z.number()).default({}),
  versions: z.array(MessageVersionSchema).optional(),
  /** Deliveries of agent or runtime messages since the user last acted. */
  automaticTurns: z.number().default(0),
  config: z.object({
    reasoningEffort: z.string().optional(),
    metadata: RunMetadataSchema.optional(),
  }),
});
type ModelMessage = z.infer<typeof ModelMessageSchema>;
/** History is replaced by `saveHistory`, never mutated, so a checkpoint can share it. */
export type AgentRecord = Omit<z.infer<typeof RecordSchema>, "history"> & {
  history: readonly ModelMessage[];
};
export type AgentStep = z.infer<typeof WireStepSchema>;

type MessageRow = {
  id: number;
  agent_id: string;
  sender: string;
  kind: string;
  content: string;
  wakes: number;
  held: number;
  attachment_ids: string;
  attachments: string;
  created_at: number;
  delivered_at: number | null;
};
const MESSAGE_COLUMNS =
  "id, agent_id, sender, kind, content, wakes, held, attachment_ids, attachments, created_at, delivered_at";
const toMessage = (row: MessageRow): InboxMessage =>
  InboxMessageSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    sender: row.sender,
    kind: row.kind,
    content: row.content,
    wakes: row.wakes === 1,
    held: row.held === 1,
    attachmentIds: JSON.parse(row.attachment_ids),
    attachments: JSON.parse(row.attachments),
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  });
/** Image bytes stay in the attachment store, not in saved history. */
export const withoutImageData = (
  message: LlmMessage | ModelMessage,
): Omit<LlmMessage, "images"> & { images?: ImageAttachment[] } =>
  message.images
    ? {
        ...message,
        images: message.images.map((i) => ImageAttachmentSchema.parse(i)),
      }
    : message;
const storedJson = (message: LlmMessage | ModelMessage) =>
  JSON.stringify(withoutImageData(message));
/** A message without image bytes; one without images is kept as is. */
const toHistory = (message: LlmMessage | ModelMessage): ModelMessage =>
  message.images
    ? {
        ...message,
        images: message.images.map((image) => ({
          ...ImageAttachmentSchema.parse(image),
          data: "",
        })),
      }
    : (message as ModelMessage);
const placeholders = (values: readonly unknown[]) =>
  values.map(() => "?").join(", ");

/**
 * Keeps one live record per agent while the runtime works in its chat, so
 * every runtime path sees the same state. Only the runtime mutates records.
 * `release` drops a chat's records, so re-read a record after an await.
 * Temporary chats use the same operations but live only in memory.
 */
export class AgentStore {
  private records = new Map<string, AgentRecord>();
  private temporary = new Map<string, AgentRecord>();
  private temporaryInbox: InboxMessage[] = [];
  /** Steps by agent, keyed by activation and position in insertion order. */
  private temporarySteps = new Map<string, Map<string, AgentStep>>();
  private nextTemporaryId = -Number.MAX_SAFE_INTEGER;
  /** The history each record last saved, which `saveHistory` compares against. */
  private savedHistory = new WeakMap<AgentRecord, readonly ModelMessage[]>();

  cachedSessions(): Set<string> {
    return new Set([...this.records.values()].map((agent) => agent.sessionId));
  }

  /** Restore existing object identities as active callers may still hold them. */
  checkpoint(sessionId: string): () => void {
    const records = [...this.records.values(), ...this.temporary.values()]
      .filter((agent) => agent.sessionId === sessionId)
      .map((agent) => ({
        agent,
        saved: {
          ...structuredClone({ ...agent, history: [] }),
          history: agent.history,
        },
        savedHistory: this.savedHistory.get(agent),
        temporary: this.temporary.has(agent.id),
      }));
    const sessionAgents = () =>
      new Set(
        [...this.temporary.values()]
          .filter((agent) => agent.sessionId === sessionId)
          .map((agent) => agent.id),
      );
    const agents = sessionAgents();
    const inbox = structuredClone(
      this.temporaryInbox.filter((m) => agents.has(m.agentId)),
    );
    // Steps are saved outside transactions, which only remove whole agents' steps.
    const steps = new Map(this.temporarySteps);
    const nextId = this.nextTemporaryId;
    return () => {
      // Includes agents created since the checkpoint.
      const current = sessionAgents();
      this.temporaryInbox = [
        ...this.temporaryInbox.filter((m) => !current.has(m.agentId)),
        ...inbox,
      ];
      this.release(sessionId);
      for (const [id, agent] of this.temporary)
        if (agent.sessionId === sessionId) this.temporary.delete(id);
      for (const { agent, saved, savedHistory, temporary } of records) {
        for (const key of ["versions", "interruption"] as const)
          delete agent[key];
        Object.assign(agent, saved);
        if (savedHistory) this.savedHistory.set(agent, savedHistory);
        else this.savedHistory.delete(agent);
        (temporary ? this.temporary : this.records).set(agent.id, agent);
      }
      this.temporarySteps = steps;
      this.nextTemporaryId = nextId;
    };
  }

  get(id: string): AgentRecord | undefined {
    const cached = this.temporary.get(id) ?? this.records.get(id);
    if (cached) return cached;
    const row = getDb()
      .query("SELECT status, data FROM agents WHERE id = ?")
      .get(id) as { status: string; data: string } | null;
    if (!row) return undefined;
    const history = getDb()
      .query(
        "SELECT message FROM agent_history WHERE agent_id = ? ORDER BY position",
      )
      .all(id) as { message: string }[];
    const agent = RecordSchema.parse({
      ...JSON.parse(row.data),
      status: row.status,
      history: history.map((message) => JSON.parse(message.message)),
    });
    this.savedHistory.set(agent, agent.history);
    this.records.set(id, agent);
    return agent;
  }
  private rows(ownerUuid: string, sessionId: string) {
    return getDb()
      .query(
        "SELECT a.id, a.status, a.data FROM agents a JOIN sessions s ON s.id = a.session_id WHERE s.owner_uuid = ? AND a.session_id = ? ORDER BY a.rowid",
      )
      .all(ownerUuid, sessionId) as {
      id: string;
      status: string;
      data: string;
    }[];
  }
  private temporaryAgents(ownerUuid: string, sessionId: string) {
    return [...this.temporary.values()].filter(
      (a) => a.ownerUuid === ownerUuid && a.sessionId === sessionId,
    );
  }
  /** A chat's live records, loading any that are not cached. */
  list(ownerUuid: string, sessionId: string): AgentRecord[] {
    return [
      ...this.rows(ownerUuid, sessionId).flatMap((row) => {
        const agent = this.get(row.id);
        return agent ? [agent] : [];
      }),
      ...this.temporaryAgents(ownerUuid, sessionId),
    ];
  }
  /** A chat's agents for display, read without caching them or their history. */
  view(ownerUuid: string, sessionId: string): Agent[] {
    return [
      ...this.rows(ownerUuid, sessionId).map(
        (row) =>
          this.records.get(row.id) ?? {
            ...JSON.parse(row.data),
            status: row.status,
          },
      ),
      ...this.temporaryAgents(ownerUuid, sessionId),
    ].map((agent) => this.present(agent));
  }
  /** An agent as clients see it. */
  present(agent: Omit<Agent, "held">): Agent {
    return AgentSchema.parse({ ...agent, held: this.isHeld(agent.id) });
  }
  /** Whether messages wait on the user to deliver them. */
  isHeld(agentId: string) {
    return this.hasWakingMessage(agentId, true);
  }
  /** The owner's chats that have an agent in one of `statuses`. */
  sessionsWithStatus(
    ownerUuid: string,
    statuses: readonly AgentStatus[],
  ): Set<string> {
    const rows = getDb()
      .query(
        `SELECT DISTINCT a.session_id FROM agents a JOIN sessions s ON s.id = a.session_id WHERE s.owner_uuid = ? AND a.status IN (${placeholders(statuses)})`,
      )
      .all(ownerUuid, ...statuses) as { session_id: string }[];
    return new Set([
      ...rows.map((row) => row.session_id),
      ...[...this.temporary.values()]
        .filter((a) => a.ownerUuid === ownerUuid && statuses.includes(a.status))
        .map((a) => a.sessionId),
    ]);
  }
  withStatus(status: AgentStatus): AgentRecord[] {
    return (
      getDb().query("SELECT id FROM agents WHERE status = ?").all(status) as {
        id: string;
      }[]
    ).flatMap((row) => this.get(row.id) ?? []);
  }
  /** Saves everything except history, which `saveHistory` writes. */
  save(agent: AgentRecord, temporary = this.temporary.has(agent.id)) {
    if (temporary) {
      this.temporary.set(agent.id, agent);
      return;
    }
    this.records.set(agent.id, agent);
    const { history: _history, status, ...data } = agent;
    getDb().run(
      "INSERT INTO agents (id, session_id, status, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data",
      [agent.id, agent.sessionId, status, JSON.stringify(data)],
    );
  }
  /**
   * Writes only the messages that changed since the last save. A message is
   * never changed once in a history, and one without images is kept as is, so
   * an unchanged message is usually the saved object and otherwise has the
   * same stored form.
   */
  saveHistory(
    agent: AgentRecord,
    history: readonly (LlmMessage | ModelMessage)[],
  ) {
    const saved = this.savedHistory.get(agent) ?? [];
    const changed = new Set<number>();
    history.forEach((message, position) => {
      const previous = saved[position];
      if (
        previous !== message &&
        (!previous || storedJson(message) !== storedJson(previous))
      )
        changed.add(position);
    });
    if (
      !this.temporary.has(agent.id) &&
      (changed.size || history.length < saved.length)
    )
      transaction(() => {
        getDb().run(
          "DELETE FROM agent_history WHERE agent_id = ? AND position >= ?",
          [agent.id, history.length],
        );
        const upsert = getDb().query(
          "INSERT INTO agent_history (agent_id, position, message) VALUES (?, ?, ?) ON CONFLICT(agent_id, position) DO UPDATE SET message = excluded.message",
        );
        for (const position of changed)
          upsert.run(agent.id, position, storedJson(history[position]!));
      });
    agent.history = history.map((message, position) =>
      changed.has(position) ? toHistory(message) : saved[position]!,
    );
    this.savedHistory.set(agent, agent.history);
  }
  /** Drops a chat's cached records once no runtime work holds them. */
  release(sessionId: string) {
    for (const [id, agent] of this.records)
      if (agent.sessionId === sessionId) this.records.delete(id);
  }
  /** The agent's saved steps across its activations, oldest first. */
  steps(agentId: string): AgentStep[] {
    const temporary = this.temporarySteps.get(agentId);
    if (temporary) return [...temporary.values()];
    return (
      getDb()
        .query("SELECT step FROM agent_steps WHERE agent_id = ? ORDER BY rowid")
        .all(agentId) as { step: string }[]
    ).map((row) => WireStepSchema.parse(JSON.parse(row.step)));
  }
  /** Saves one step of an activation, adding it or replacing its last state. */
  saveStep(
    agent: AgentRecord,
    activationId: string,
    position: number,
    step: AgentStep,
  ) {
    if (this.temporary.has(agent.id)) {
      const steps = this.temporarySteps.get(agent.id) ?? new Map();
      steps.set(`${activationId}:${position}`, step);
      this.temporarySteps.set(agent.id, steps);
      return;
    }
    getDb().run(
      "INSERT INTO agent_steps (agent_id, activation_id, position, step) VALUES (?, ?, ?, ?) ON CONFLICT(agent_id, activation_id, position) DO UPDATE SET step = excluded.step",
      [agent.id, activationId, position, JSON.stringify(step)],
    );
  }
  /** The main agent's reply text since its last transcript segment. */
  reply(agentId: string): string | undefined {
    const row = getDb()
      .query("SELECT content FROM agent_replies WHERE agent_id = ?")
      .get(agentId) as { content: string } | null;
    return row?.content;
  }
  /** Keeps the open reply for restart recovery, which temporary chats lack. */
  saveReply(agent: AgentRecord, content: string) {
    if (this.temporary.has(agent.id)) return;
    getDb().run(
      "INSERT INTO agent_replies (agent_id, content) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET content = excluded.content",
      [agent.id, content],
    );
  }
  /** Removes a main agent's open segment once it is in the transcript. */
  clearSegment(agent: AgentRecord) {
    this.temporarySteps.delete(agent.id);
    getDb().run("DELETE FROM agent_steps WHERE agent_id = ?", [agent.id]);
    getDb().run("DELETE FROM agent_replies WHERE agent_id = ?", [agent.id]);
  }
  remove(agent: AgentRecord) {
    this.records.delete(agent.id);
    this.temporary.delete(agent.id);
    this.temporarySteps.delete(agent.id);
    this.temporaryInbox = this.temporaryInbox.filter(
      (m) => m.agentId !== agent.id && m.sender !== agent.id,
    );
    getDb().run("DELETE FROM agent_messages WHERE sender = ?", [agent.id]);
    getDb().run("DELETE FROM agents WHERE id = ?", [agent.id]);
  }

  private messages(where: string, ...values: (string | number)[]) {
    return (
      getDb()
        .query(`SELECT ${MESSAGE_COLUMNS} FROM agent_messages WHERE ${where}`)
        .all(...values) as MessageRow[]
    ).map(toMessage);
  }
  private temporaryMessages(agentId: string) {
    return this.temporaryInbox.filter((m) => m.agentId === agentId);
  }
  inbox(agentId: string): InboxMessage[] {
    return [
      ...this.messages("agent_id = ? ORDER BY id", agentId),
      ...this.temporaryMessages(agentId),
    ];
  }
  undelivered(agentId: string): InboxMessage[] {
    return [
      ...this.messages(
        "agent_id = ? AND delivered_at IS NULL ORDER BY id",
        agentId,
      ),
      ...this.temporaryMessages(agentId).filter((m) => m.deliveredAt === null),
    ];
  }
  /** Agents with undelivered messages that wake them, oldest message first. */
  pendingAgentIds(): string[] {
    const rows = getDb()
      .query(
        "SELECT agent_id FROM agent_messages WHERE delivered_at IS NULL AND held = 0 AND wakes = 1 GROUP BY agent_id ORDER BY MIN(id)",
      )
      .all() as { agent_id: string }[];
    return [
      ...new Set([
        ...rows.map((row) => row.agent_id),
        ...this.temporaryInbox
          .filter((m) => m.deliveredAt === null && !m.held && m.wakes)
          .map((m) => m.agentId),
      ]),
    ];
  }
  /** Whether an undelivered message that wakes the agent is held or not. */
  hasWakingMessage(agentId: string, held: boolean): boolean {
    if (this.temporary.has(agentId))
      return this.temporaryMessages(agentId).some(
        (m) => m.deliveredAt === null && m.wakes && m.held === held,
      );
    return (
      getDb()
        .query(
          "SELECT 1 FROM agent_messages WHERE agent_id = ? AND delivered_at IS NULL AND wakes = 1 AND held = ? LIMIT 1",
        )
        .get(agentId, held ? 1 : 0) !== null
    );
  }
  enqueue(
    message: Omit<
      InboxMessage,
      "id" | "createdAt" | "deliveredAt" | "held" | "attachments"
    > & { attachments?: InboxMessage["attachments"] },
  ): InboxMessage {
    const row: InboxMessage = {
      ...message,
      attachments: message.attachments ?? [],
      id: 0,
      createdAt: Date.now(),
      deliveredAt: null,
      held: false,
    };
    if (this.temporary.has(message.agentId)) {
      row.id = this.nextTemporaryId++;
      this.temporaryInbox.push(row);
    } else
      row.id = Number(
        getDb().run(
          "INSERT INTO agent_messages (agent_id, sender, kind, content, wakes, attachment_ids, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            row.agentId,
            row.sender,
            row.kind,
            row.content,
            row.wakes ? 1 : 0,
            JSON.stringify(row.attachmentIds),
            JSON.stringify(row.attachments),
            row.createdAt,
          ],
        ).lastInsertRowid,
      );
    return row;
  }
  deliver(messages: InboxMessage[]) {
    transaction(() => {
      for (const message of messages) {
        message.deliveredAt = Date.now();
        if (message.id >= 0)
          getDb().run(
            "UPDATE agent_messages SET delivered_at = ? WHERE id = ?",
            [message.deliveredAt, message.id],
          );
      }
    });
  }
  /** Holds or releases every undelivered message for the agent. */
  hold(agentId: string, held: boolean) {
    for (const message of this.temporaryMessages(agentId))
      if (message.deliveredAt === null) message.held = held;
    getDb().run(
      "UPDATE agent_messages SET held = ? WHERE agent_id = ? AND delivered_at IS NULL",
      [held ? 1 : 0, agentId],
    );
  }
  editQueued(agentId: string, id: number, content: string): boolean {
    if (id < 0) {
      const message = this.queuedTemporary(agentId, id);
      if (message) message.content = content;
      return Boolean(message);
    }
    return (
      getDb().run(
        "UPDATE agent_messages SET content = ? WHERE id = ? AND agent_id = ? AND kind = 'user' AND delivered_at IS NULL",
        [content, id, agentId],
      ).changes > 0
    );
  }
  removeQueued(agentId: string, id: number): boolean {
    if (id < 0) {
      const message = this.queuedTemporary(agentId, id);
      this.temporaryInbox = this.temporaryInbox.filter((m) => m !== message);
      return Boolean(message);
    }
    return (
      getDb().run(
        "DELETE FROM agent_messages WHERE id = ? AND agent_id = ? AND kind = 'user' AND delivered_at IS NULL",
        [id, agentId],
      ).changes > 0
    );
  }
  private queuedTemporary(agentId: string, id: number) {
    return this.temporaryMessages(agentId).find(
      (m) => m.id === id && m.kind === "user" && m.deliveredAt === null,
    );
  }
}
