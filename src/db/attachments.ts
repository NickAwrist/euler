import crypto from "node:crypto";
import type { ImageAttachment, ImageMimeType } from "../attachments/types";
import { getDb } from "./connection";

export type AttachmentRow = ImageAttachment & {
  ownerUuid: string;
  sessionId: string;
  data: Uint8Array;
  createdAt: number;
};

type DbAttachmentRow = {
  id: string;
  owner_uuid: string;
  session_id: string;
  kind: "image";
  name: string;
  mime_type: ImageMimeType;
  size: number;
  data: Uint8Array;
  created_at: number;
};

function fromDb(row: DbAttachmentRow): AttachmentRow {
  return {
    id: row.id,
    ownerUuid: row.owner_uuid,
    sessionId: row.session_id,
    kind: row.kind,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    data: row.data,
    createdAt: row.created_at,
  };
}

export function createImageAttachment(input: {
  ownerUuid: string;
  sessionId: string;
  name: string;
  mimeType: ImageMimeType;
  data: Uint8Array;
}): ImageAttachment {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  getDb().run(
    `INSERT INTO attachments
      (id, owner_uuid, session_id, kind, name, mime_type, size, data, created_at)
     VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?)`,
    [
      id,
      input.ownerUuid,
      input.sessionId,
      input.name,
      input.mimeType,
      input.data.byteLength,
      input.data,
      createdAt,
    ],
  );
  return {
    id,
    kind: "image",
    name: input.name,
    mimeType: input.mimeType,
    size: input.data.byteLength,
  };
}

export function getAttachment(
  ownerUuid: string,
  id: string,
): AttachmentRow | null {
  const row = getDb()
    .query(
      `SELECT id, owner_uuid, session_id, kind, name, mime_type, size, data, created_at
       FROM attachments WHERE owner_uuid = ? AND id = ?`,
    )
    .get(ownerUuid, id) as DbAttachmentRow | null;
  return row ? fromDb(row) : null;
}

export function deleteAttachment(ownerUuid: string, id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM attachments WHERE owner_uuid = ? AND id = ?")
    .run(ownerUuid, id);
  return result.changes > 0;
}
