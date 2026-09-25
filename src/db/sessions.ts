import { MessageAttachmentSchema } from "../attachments/types";
import { getDb } from "./connection";
import type { SessionRow, SessionSummaryRow, WireMessage } from "./types";

export type { SessionRow, SessionSummaryRow, WireMessage } from "./types";

function previewFromTitleAndFirstUser(
  title: string | null,
  firstUser: string | null,
): string {
  const t = title?.trim();
  if (t) return t;
  if (firstUser?.trim()) {
    const u = firstUser.trim();
    return u.length > 40 ? `${u.slice(0, 40)}...` : u;
  }
  return "New run";
}

export function listSessionSummaries(ownerUuid: string): SessionSummaryRow[] {
  const db = getDb();
  const sessions = db
    .query(
      "SELECT id, created_at, updated_at, title FROM sessions WHERE owner_uuid = ? ORDER BY updated_at DESC",
    )
    .all(ownerUuid) as Array<{
    id: string;
    created_at: number;
    updated_at: number;
    title: string | null;
  }>;

  const firstUserStmt = db.query(
    `SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY position ASC LIMIT 1`,
  );

  return sessions.map((s) => {
    const fu = firstUserStmt.get(s.id) as { content: string } | null;
    return {
      id: s.id,
      created_at: s.created_at,
      updated_at: s.updated_at,
      title: s.title,
      preview: previewFromTitleAndFirstUser(s.title, fu?.content ?? null),
    };
  });
}

export function getSessionById(
  ownerUuid: string,
  id: string,
): SessionRow | null {
  const row = getDb()
    .query(
      "SELECT id, owner_uuid, created_at, updated_at, title, model, model_messages, session_directory, workspace_kind FROM sessions WHERE owner_uuid = ? AND id = ?",
    )
    .get(ownerUuid, id) as SessionRow | null;
  return row ?? null;
}

export function countMessagesForSession(sessionId: string): number {
  const row = getDb()
    .query("SELECT COUNT(*) as c FROM messages WHERE session_id = ?")
    .get(sessionId) as { c: number } | null;
  return row?.c ?? 0;
}

export function appendSessionEvent(
  ownerUuid: string,
  sessionId: string,
  content: string,
): boolean {
  if (!getSessionById(ownerUuid, sessionId)) return false;
  const db = getDb();
  const position = countMessagesForSession(sessionId);
  db.run(
    "INSERT INTO messages (session_id, role, content, steps, attachments, position) VALUES (?, 'event', ?, NULL, NULL, ?)",
    [sessionId, content, position],
  );
  db.run("UPDATE sessions SET updated_at = ? WHERE owner_uuid = ? AND id = ?", [
    Date.now(),
    ownerUuid,
    sessionId,
  ]);
  return true;
}

export function getMessagesForSession(
  ownerUuid: string,
  sessionId: string,
): WireMessage[] {
  if (!getSessionById(ownerUuid, sessionId)) return [];
  const rows = getDb()
    .query(
      "SELECT role, content, steps, attachments FROM messages WHERE session_id = ? ORDER BY position ASC",
    )
    .all(sessionId) as Array<{
    role: string;
    content: string;
    steps: string | null;
    attachments: string | null;
  }>;

  return rows.map((r) => {
    const msg: WireMessage = { role: r.role, content: r.content };
    if (r.steps != null && r.steps !== "") {
      try {
        msg.steps = JSON.parse(r.steps) as unknown;
      } catch {
        /* ignore */
      }
    }
    if (r.attachments) {
      try {
        const parsed = JSON.parse(r.attachments) as unknown;
        if (Array.isArray(parsed)) {
          const attachments = parsed.flatMap((value) => {
            const result = MessageAttachmentSchema.safeParse(value);
            return result.success ? [result.data] : [];
          });
          if (attachments.length > 0) msg.attachments = attachments;
        }
      } catch {
        /* ignore */
      }
    }
    return msg;
  });
}

export function parseModelMessages(
  json: string | null,
): Array<Record<string, unknown>> | null {
  if (json == null || json === "") return null;
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : null;
  } catch {
    return null;
  }
}

export function createSessionRow(
  ownerUuid: string,
  id: string,
  now: number,
  model: string | null,
): SessionRow {
  const db = getDb();
  db.run(
    "INSERT INTO sessions (id, owner_uuid, created_at, updated_at, title, model, model_messages) VALUES (?, ?, ?, ?, NULL, ?, NULL)",
    [id, ownerUuid, now, now, model],
  );
  return {
    id,
    owner_uuid: ownerUuid,
    created_at: now,
    updated_at: now,
    title: null,
    model,
    model_messages: null,
    session_directory: null,
    workspace_kind: "sandbox",
  };
}

export function deleteSessionRow(ownerUuid: string, id: string): boolean {
  const db = getDb();
  const r = db.run("DELETE FROM sessions WHERE owner_uuid = ? AND id = ?", [
    ownerUuid,
    id,
  ]);
  return r.changes > 0;
}

export function patchSessionRow(
  ownerUuid: string,
  id: string,
  patch: {
    title?: string | null;
    model?: string | null;
    model_messages?: Array<Record<string, unknown>> | null;
    session_directory?: string | null;
    workspace_kind?: "sandbox" | "local";
    updated_at?: number;
  },
): boolean {
  const existing = getSessionById(ownerUuid, id);
  if (!existing) return false;

  const title = patch.title !== undefined ? patch.title : existing.title;
  const model = patch.model !== undefined ? patch.model : existing.model;
  const sessionDirectory =
    patch.session_directory !== undefined
      ? patch.session_directory
      : existing.session_directory;
  const workspaceKind = patch.workspace_kind ?? existing.workspace_kind;
  let modelMessagesJson: string | null = existing.model_messages;
  if (patch.model_messages !== undefined) {
    modelMessagesJson =
      patch.model_messages == null
        ? null
        : JSON.stringify(patch.model_messages);
  }
  const updatedAt = patch.updated_at ?? Date.now();

  getDb().run(
    "UPDATE sessions SET title = ?, model = ?, model_messages = ?, session_directory = ?, workspace_kind = ?, updated_at = ? WHERE owner_uuid = ? AND id = ?",
    [
      title,
      model,
      modelMessagesJson,
      sessionDirectory,
      workspaceKind,
      updatedAt,
      ownerUuid,
      id,
    ],
  );
  return true;
}

/**
 * Persists run history without rewriting the full table each time: truncates when the
 * client sends a shorter history, appends new tail rows, or updates the last row when
 * the count is unchanged (e.g. assistant steps filled in).
 */
export function persistSessionMessages(
  ownerUuid: string,
  sessionId: string,
  messages: WireMessage[],
  modelMessages: Array<Record<string, unknown>> | null,
  updatedAt: number,
  runModel?: string | null,
): boolean {
  const row = getSessionById(ownerUuid, sessionId);
  if (!row) return false;
  const db = getDb();
  const nextModel =
    typeof runModel === "string" && runModel.trim()
      ? runModel.trim()
      : row.model;
  const tx = db.transaction(() => {
    let n = countMessagesForSession(sessionId);
    if (messages.length < n) {
      db.run("DELETE FROM messages WHERE session_id = ? AND position >= ?", [
        sessionId,
        messages.length,
      ]);
      n = countMessagesForSession(sessionId);
    }

    const insert = db.prepare(
      "INSERT INTO messages (session_id, role, content, steps, attachments, position) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (let i = n; i < messages.length; i++) {
      const m = messages[i]!;
      const stepsJson =
        m.steps !== undefined && m.steps != null
          ? JSON.stringify(m.steps)
          : null;
      const attachmentsJson = m.attachments?.length
        ? JSON.stringify(
            m.attachments.map((attachment) =>
              MessageAttachmentSchema.parse(attachment),
            ),
          )
        : null;
      insert.run(sessionId, m.role, m.content, stepsJson, attachmentsJson, i);
    }

    if (messages.length > 0 && n === messages.length) {
      const last = messages[messages.length - 1]!;
      const stepsJson =
        last.steps !== undefined && last.steps != null
          ? JSON.stringify(last.steps)
          : null;
      const attachmentsJson = last.attachments?.length
        ? JSON.stringify(
            last.attachments.map((attachment) =>
              MessageAttachmentSchema.parse(attachment),
            ),
          )
        : null;
      db.run(
        "UPDATE messages SET content = ?, steps = ?, attachments = ? WHERE session_id = ? AND position = ?",
        [
          last.content,
          stepsJson,
          attachmentsJson,
          sessionId,
          messages.length - 1,
        ],
      );
    }

    const mmJson = modelMessages == null ? null : JSON.stringify(modelMessages);
    db.run(
      "UPDATE sessions SET model_messages = ?, updated_at = ?, model = ? WHERE owner_uuid = ? AND id = ?",
      [mmJson, updatedAt, nextModel, ownerUuid, sessionId],
    );
  });
  tx();
  return true;
}
