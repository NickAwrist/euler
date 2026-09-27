import { z } from "zod";
import {
  type ImageAttachment,
  ImageAttachmentSchema,
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
  WireMessageSchema,
} from "../schemas/run";
import { getDb, transaction } from "./connection";

const RecordSchema = AgentSchema.extend({
  history: z.array(ModelMessageSchema),
  partial: WireMessageSchema.optional(),
  lastSummaryAt: z.number().default(0),
  checkpoints: z.record(z.string(), z.number()).default({}),
  versions: z.array(MessageVersionSchema).optional(),
  held: z.boolean(),
  modelCalls: z.number().default(0),
  config: z.object({
    reasoningEffort: z.string().optional(),
    metadata: RunMetadataSchema.optional(),
  }),
});
export type AgentRecord = z.infer<typeof RecordSchema>;

type MessageRow = {
  id: number;
  agent_id: string;
  sender: string;
  kind: string;
  content: string;
  wakes: number;
  held: number;
  attachment_ids: string;
  created_at: number;
  delivered_at: number | null;
};
const MESSAGE_COLUMNS =
  "id, agent_id, sender, kind, content, wakes, held, attachment_ids, created_at, delivered_at";
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
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  });
/** Image bytes stay in the attachment store, not in saved history. */
const withoutImageData = ({
  images,
  ...message
}: LlmMessage): Omit<LlmMessage, "images"> & { images?: ImageAttachment[] } =>
  images
    ? { ...message, images: images.map((i) => ImageAttachmentSchema.parse(i)) }
    : message;
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
  private nextTemporaryId = -Number.MAX_SAFE_INTEGER;

  cachedSessions(): Set<string> {
    return new Set([...this.records.values()].map((agent) => agent.sessionId));
  }

  /** Restore existing object identities as active callers may still hold them. */
  checkpoint(sessionId: string): () => void {
    const records = [...this.records.values(), ...this.temporary.values()]
      .filter((agent) => agent.sessionId === sessionId)
      .map((agent) => ({
        agent,
        saved: structuredClone(agent),
        temporary: this.temporary.has(agent.id),
      }));
    const inbox = structuredClone(this.temporaryInbox);
    const nextId = this.nextTemporaryId;
    return () => {
      this.release(sessionId);
      for (const [id, agent] of this.temporary)
        if (agent.sessionId === sessionId) this.temporary.delete(id);
      for (const { agent, saved, temporary } of records) {
        for (const key of ["partial", "versions", "interruption"] as const)
          delete agent[key];
        Object.assign(agent, saved);
        (temporary ? this.temporary : this.records).set(agent.id, agent);
      }
      this.temporaryInbox = inbox;
      this.nextTemporaryId = nextId;
    };
  }

  get(id: string): AgentRecord | undefined {
    const cached = this.temporary.get(id) ?? this.records.get(id);
    if (cached) return cached;
    const row = getDb()
      .query(
        "SELECT a.status, a.history, a.data, s.model_messages FROM agents a JOIN sessions s ON s.id = a.session_id WHERE a.id = ?",
      )
      .get(id) as {
      status: string;
      history: string;
      data: string;
      model_messages: string | null;
    } | null;
    if (!row) return undefined;
    const data = AgentSchema.passthrough().parse({
      ...JSON.parse(row.data),
      status: row.status,
    });
    const agent = RecordSchema.parse({
      ...data,
      history: JSON.parse(
        data.kind === "main" ? (row.model_messages ?? "[]") : row.history,
      ),
    });
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
    ].map((agent) => AgentSchema.parse(agent));
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
  saveHistory(agent: AgentRecord, history: LlmMessage[]) {
    const stored = history.map(withoutImageData);
    agent.history = stored.map(({ images, ...message }) =>
      images
        ? {
            ...message,
            images: images.map((image) => ({ ...image, data: "" })),
          }
        : message,
    );
    if (this.temporary.has(agent.id)) return;
    const json = JSON.stringify(stored);
    if (agent.kind === "main")
      getDb().run(
        "UPDATE sessions SET model_messages = ? WHERE id = ? AND owner_uuid = ?",
        [json, agent.sessionId, agent.ownerUuid],
      );
    else
      getDb().run("UPDATE agents SET history = ? WHERE id = ?", [
        json,
        agent.id,
      ]);
  }
  /** Drops a chat's cached records once no runtime work holds them. */
  release(sessionId: string) {
    for (const [id, agent] of this.records)
      if (agent.sessionId === sessionId) this.records.delete(id);
  }
  remove(agent: AgentRecord) {
    this.records.delete(agent.id);
    this.temporary.delete(agent.id);
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
    message: Omit<InboxMessage, "id" | "createdAt" | "deliveredAt" | "held">,
  ): InboxMessage {
    const row: InboxMessage = {
      ...message,
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
          "INSERT INTO agent_messages (agent_id, sender, kind, content, wakes, attachment_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            row.agentId,
            row.sender,
            row.kind,
            row.content,
            row.wakes ? 1 : 0,
            JSON.stringify(row.attachmentIds),
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
