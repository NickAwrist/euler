import { MessageAttachmentSchema } from "../attachments/types";
import { MessageVersionSchema } from "../schemas/run";
import { stripSkillReferences } from "../skills/runtime";
import { getDb } from "./connection";
import { listSkills } from "./skills/queries";
import type { SessionRow, SessionSummaryRow, WireMessage } from "./types";

export type { SessionRow, SessionSummaryRow, WireMessage } from "./types";

function previewFromTitleAndFirstUser(
  title: string | null,
  firstUser: string | null,
  skillNames: ReadonlySet<string>,
): string {
  const t = title?.trim();
  if (t) return t;
  const message = firstUser?.trim();
  if (message) {
    // A message that is only skill references keeps them as its preview.
    const u = stripSkillReferences(message, skillNames) || message;
    return u.length > 40 ? `${u.slice(0, 40)}...` : u;
  }
  return "New run";
}

export function listSessionSummaries(ownerUuid: string): SessionSummaryRow[] {
  const db = getDb();
  const sessions = db
    .query(
      "SELECT id, created_at, updated_at, title, last_activity_at > last_viewed_at AS unread FROM sessions WHERE owner_uuid = ? ORDER BY updated_at DESC",
    )
    .all(ownerUuid) as Array<{
    id: string;
    created_at: number;
    updated_at: number;
    title: string | null;
    unread: number;
  }>;

  const skillNames = new Set(listSkills(ownerUuid).map((skill) => skill.name));
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
      unread: s.unread === 1,
      preview: previewFromTitleAndFirstUser(
        s.title,
        fu?.content ?? null,
        skillNames,
      ),
    };
  });
}

/** The sidebar label of one chat, or null when it no longer exists. */
export function getSessionLabel(ownerUuid: string, id: string): string | null {
  const row = getDb()
    .query(
      `SELECT s.title, (SELECT content FROM messages WHERE session_id = s.id AND role = 'user' ORDER BY position ASC LIMIT 1) AS first_user
       FROM sessions s WHERE s.owner_uuid = ? AND s.id = ?`,
    )
    .get(ownerUuid, id) as {
    title: string | null;
    first_user: string | null;
  } | null;
  if (!row) return null;
  return previewFromTitleAndFirstUser(
    row.title,
    row.first_user,
    new Set(listSkills(ownerUuid).map((skill) => skill.name)),
  );
}

/** A sandbox stays alive while its originating chat or any linked chat exists. */
export function isWorkspaceReferenced(
  ownerUuid: string,
  workspaceId: string,
): boolean {
  return (
    getDb()
      .query(
        "SELECT 1 FROM sessions WHERE owner_uuid = ? AND (id = ? OR linked_workspace_id = ?) LIMIT 1",
      )
      .get(ownerUuid, workspaceId, workspaceId) !== null
  );
}

export function getSessionById(
  ownerUuid: string,
  id: string,
): SessionRow | null {
  const row = getDb()
    .query(
      "SELECT id, owner_uuid, created_at, updated_at, title, model, session_directory, workspace_kind, linked_workspace_id FROM sessions WHERE owner_uuid = ? AND id = ?",
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
      "SELECT id, activation_id, role, content, steps, attachments, versions FROM messages WHERE session_id = ? ORDER BY position ASC",
    )
    .all(sessionId) as Array<{
    id: number;
    activation_id: string | null;
    role: string;
    content: string;
    steps: string | null;
    attachments: string | null;
    versions: string | null;
  }>;

  return rows.map((r) => {
    const msg: WireMessage = {
      id: r.id,
      ...(r.activation_id ? { activationId: r.activation_id } : {}),
      role: r.role,
      content: r.content,
    };
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
    if (r.versions) {
      try {
        const parsed = MessageVersionSchema.array().safeParse(
          JSON.parse(r.versions),
        );
        if (parsed.success && parsed.data.length > 0) {
          msg.versions = parsed.data;
        }
      } catch {
        /* ignore */
      }
    }
    return msg;
  });
}

/** JSON columns for one message row. */
function messageColumns(m: WireMessage) {
  return {
    steps: m.steps != null ? JSON.stringify(m.steps) : null,
    attachments: m.attachments?.length
      ? JSON.stringify(
          m.attachments.map((attachment) =>
            MessageAttachmentSchema.parse(attachment),
          ),
        )
      : null,
    versions: m.versions?.length ? JSON.stringify(m.versions) : null,
  };
}

export function createSessionRow(
  ownerUuid: string,
  id: string,
  now: number,
  model: string | null,
): SessionRow {
  const db = getDb();
  db.run(
    "INSERT INTO sessions (id, owner_uuid, created_at, updated_at, title, model) VALUES (?, ?, ?, ?, NULL, ?)",
    [id, ownerUuid, now, now, model],
  );
  return {
    id,
    owner_uuid: ownerUuid,
    created_at: now,
    updated_at: now,
    title: null,
    model,
    session_directory: null,
    workspace_kind: "sandbox",
    linked_workspace_id: null,
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
    session_directory?: string | null;
    workspace_kind?: "sandbox" | "local";
    linked_workspace_id?: string | null;
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
  const linkedWorkspaceId =
    patch.linked_workspace_id !== undefined
      ? patch.linked_workspace_id
      : existing.linked_workspace_id;
  const updatedAt = patch.updated_at ?? Date.now();

  getDb().run(
    "UPDATE sessions SET title = ?, model = ?, session_directory = ?, workspace_kind = ?, linked_workspace_id = ?, updated_at = ? WHERE owner_uuid = ? AND id = ?",
    [
      title,
      model,
      sessionDirectory,
      workspaceKind,
      linkedWorkspaceId,
      updatedAt,
      ownerUuid,
      id,
    ],
  );
  return true;
}

/** Runtime-owned transcript writes never replace another writer's history. */
export function appendRuntimeMessage(
  ownerUuid: string,
  sessionId: string,
  message: WireMessage,
): number {
  if (!getSessionById(ownerUuid, sessionId))
    throw new Error("Session not found");
  const db = getDb();
  return db.transaction(() => {
    const { steps, attachments, versions } = messageColumns(message);
    const id = Number(
      db.run(
        "INSERT INTO messages (session_id, role, content, steps, attachments, versions, position, activation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          sessionId,
          message.role,
          message.content,
          steps,
          attachments,
          versions,
          countMessagesForSession(sessionId),
          message.activationId ?? null,
        ],
      ).lastInsertRowid,
    );
    db.run(
      "UPDATE sessions SET updated_at = ?, last_activity_at = ? WHERE id = ?",
      [Date.now(), Date.now(), sessionId],
    );
    return id;
  })();
}

export function markSessionViewed(ownerUuid: string, sessionId: string) {
  getDb().run(
    "UPDATE sessions SET last_viewed_at = ? WHERE id = ? AND owner_uuid = ?",
    [Date.now(), sessionId, ownerUuid],
  );
}

/** Removes transcript messages from `position` on. */
export function truncateSessionMessages(sessionId: string, position: number) {
  getDb().run("DELETE FROM messages WHERE session_id = ? AND position >= ?", [
    sessionId,
    position,
  ]);
}
