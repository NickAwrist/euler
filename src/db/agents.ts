import { z } from "zod";
import { ImageAttachmentSchema } from "../attachments/types";
import type { LlmMessage } from "../llm";
import {
  type Agent,
  AgentSchema,
  type InboxMessage,
  InboxMessageSchema,
} from "../schemas/agents";
import { ModelMessageSchema } from "../schemas/modelMessages";
import type { WireMessageInput } from "../schemas/run";
import { MessageVersionSchema, WireMessageSchema } from "../schemas/run";
import { getDb } from "./connection";

export type AgentRecord = Agent & {
  history: LlmMessage[];
  held: boolean;
  wakes: number;
  partial?: WireMessageInput;
  checkpoints: Record<string, number>;
  lastSummaryAt: number;
  versions?: WireMessageInput["versions"];
  config: {
    reasoningEffort?: string;
    metadata?: {
      systemPrompt?: string;
      name?: string;
      location?: string;
      preferredFormats?: string;
      includeCurrentDate?: boolean;
    };
  };
};
const RecordSchema = AgentSchema.extend({
  history: z.array(ModelMessageSchema),
  partial: WireMessageSchema.optional(),
  lastSummaryAt: z.number().default(0),
  checkpoints: z.record(z.string(), z.number()).default({}),
  versions: z.array(MessageVersionSchema).optional(),
  held: z.boolean(),
  wakes: z.number(),
  config: z.object({
    reasoningEffort: z.string().optional(),
    metadata: z
      .object({
        systemPrompt: z.string().optional(),
        name: z.string().optional(),
        location: z.string().optional(),
        preferredFormats: z.string().optional(),
        includeCurrentDate: z.boolean().optional(),
      })
      .optional(),
  }),
});

/** A temporary chat uses the same store operations without writing to SQLite. */
export class AgentStore {
  private records = new Map<string, AgentRecord>();
  private temporary = new Map<string, AgentRecord>();
  private temporaryInbox: InboxMessage[] = [];
  private nextTemporaryId = -Number.MAX_SAFE_INTEGER;

  list(ownerUuid?: string, sessionId?: string): AgentRecord[] {
    const rows = getDb()
      .query(
        "SELECT a.id FROM agents a JOIN sessions s ON s.id = a.session_id WHERE (? IS NULL OR s.owner_uuid = ?) AND (? IS NULL OR a.session_id = ?)",
      )
      .all(
        ownerUuid ?? null,
        ownerUuid ?? null,
        sessionId ?? null,
        sessionId ?? null,
      ) as { id: string }[];
    return [
      ...rows.flatMap((row) => {
        const agent = this.get(row.id);
        return agent ? [agent] : [];
      }),
      ...this.temporary.values(),
    ].filter(
      (a) =>
        (!ownerUuid || a.ownerUuid === ownerUuid) &&
        (!sessionId || a.sessionId === sessionId),
    );
  }
  get(id: string): AgentRecord | undefined {
    const cached = this.temporary.get(id) ?? this.records.get(id);
    if (cached) return cached;
    const row = getDb()
      .query(
        "SELECT a.data, s.model_messages FROM agents a JOIN sessions s ON s.id = a.session_id WHERE a.id = ?",
      )
      .get(id) as { data: string; model_messages: string | null } | null;
    if (!row) return undefined;
    const data = AgentSchema.passthrough().parse(JSON.parse(row.data));
    const agent = RecordSchema.parse(
      data.kind === "main"
        ? { ...data, history: JSON.parse(row.model_messages ?? "[]") }
        : data,
    );
    this.records.set(id, agent);
    return agent;
  }
  save(agent: AgentRecord, temporary = this.temporary.has(agent.id)) {
    this.records.set(agent.id, agent);
    if (temporary) {
      this.temporary.set(agent.id, agent);
      return;
    }
    const db = getDb();
    const history = agent.history.map((message) => ({
      ...message,
      ...(message.images
        ? {
            images: message.images.map((image) =>
              ImageAttachmentSchema.parse(image),
            ),
          }
        : {}),
    }));
    db.transaction(() => {
      db.run(
        "INSERT INTO agents (id, session_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        [
          agent.id,
          agent.sessionId,
          JSON.stringify({
            ...agent,
            history: agent.kind === "main" ? undefined : history,
          }),
        ],
      );
      if (agent.kind === "main")
        db.run(
          "UPDATE sessions SET model_messages = ? WHERE id = ? AND owner_uuid = ?",
          [JSON.stringify(history), agent.sessionId, agent.ownerUuid],
        );
    })();
  }
  inbox(agentId: string): InboxMessage[] {
    const rows = getDb()
      .query("SELECT data FROM agent_messages WHERE agent_id = ? ORDER BY id")
      .all(agentId) as { data: string }[];
    return [
      ...rows.map((row) => InboxMessageSchema.parse(JSON.parse(row.data))),
      ...this.temporaryInbox.filter((m) => m.agentId === agentId),
    ];
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
    } else {
      const db = getDb();
      db.transaction(() => {
        row.id = Number(
          db.run(
            "INSERT INTO agent_messages (agent_id, data) VALUES (?, '{}')",
            [message.agentId],
          ).lastInsertRowid,
        );
        db.run("UPDATE agent_messages SET data = ? WHERE id = ?", [
          JSON.stringify(row),
          row.id,
        ]);
      })();
    }
    return row;
  }
  deliver(messages: InboxMessage[]) {
    for (const message of messages) {
      message.deliveredAt = Date.now();
      if (message.id < 0) continue;
      getDb().run("UPDATE agent_messages SET data = ? WHERE id = ?", [
        JSON.stringify(message),
        message.id,
      ]);
    }
  }
  hold(messages: InboxMessage[], held: boolean) {
    for (const message of messages) {
      if (message.deliveredAt !== null) continue;
      message.held = held;
      if (message.id < 0) continue;
      getDb().run("UPDATE agent_messages SET data = ? WHERE id = ?", [
        JSON.stringify(message),
        message.id,
      ]);
    }
  }
  editQueued(agentId: string, id: number, content: string): boolean {
    const message = this.inbox(agentId).find(
      (m) => m.id === id && m.kind === "user" && m.deliveredAt === null,
    );
    if (!message) return false;
    message.content = content;
    if (id >= 0)
      getDb().run("UPDATE agent_messages SET data = ? WHERE id = ?", [
        JSON.stringify(message),
        id,
      ]);
    return true;
  }
  removeQueued(agentId: string, id: number): boolean {
    const message = this.inbox(agentId).find(
      (m) => m.id === id && m.kind === "user" && m.deliveredAt === null,
    );
    if (!message) return false;
    if (id < 0)
      this.temporaryInbox = this.temporaryInbox.filter((m) => m.id !== id);
    else
      getDb().run("DELETE FROM agent_messages WHERE id = ? AND agent_id = ?", [
        id,
        agentId,
      ]);
    return true;
  }
  remove(agent: AgentRecord) {
    this.records.delete(agent.id);
    this.temporary.delete(agent.id);
    this.temporaryInbox = this.temporaryInbox.filter(
      (m) => m.agentId !== agent.id,
    );
    getDb().run("DELETE FROM agents WHERE id = ?", [agent.id]);
  }
}
