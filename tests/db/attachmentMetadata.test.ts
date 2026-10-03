import "../env-setup";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { getDb, resetDbConnection } from "../../src/db";
import { migrateAttachmentMetadata } from "../../src/db/attachmentMetadataMigration";
import { createImageAttachment, getAttachment } from "../../src/db/attachments";
import { createSessionRow } from "../../src/db/sessions";
import { appendRuntimeMessage } from "../../src/db/sessions";

const image = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "image" as const,
  name: "pasted.png",
  mimeType: "image/png" as const,
  size: 3,
};

test("legacy attachment migration removes embedded bytes without changing history or file references", () => {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE messages (id INTEGER PRIMARY KEY, content TEXT, attachments TEXT)",
  );
  const file = {
    id: "00000000-0000-4000-8000-000000000002",
    kind: "file",
    name: "output.txt",
    size: 5,
    path: "output.txt",
    sessionId: "session",
    workspaceKind: "sandbox",
  };
  db.run("INSERT INTO messages VALUES (1, 'original text', ?)", [
    JSON.stringify([
      { ...image, data: { 0: 1, 1: 2, 2: 3 }, ownerUuid: "owner" },
      file,
    ]),
  ]);
  db.run("INSERT INTO messages VALUES (2, 'malformed', ?)", [
    '[{"data":invalid}]',
  ]);
  migrateAttachmentMetadata(db);
  const rows = db.query("SELECT * FROM messages ORDER BY id").all();
  expect(rows[0]).toEqual({
    id: 1,
    content: "original text",
    attachments: JSON.stringify([image, file]),
  });
  expect(rows[1]).toEqual({
    id: 2,
    content: "malformed",
    attachments: '[{"data":invalid}]',
  });
  migrateAttachmentMetadata(db);
  expect(db.query("SELECT * FROM messages ORDER BY id").all()).toEqual(rows);
  db.close();
});

test("initial and final run persistence store attachment metadata while preserving the image blob", () => {
  resetDbConnection();
  try {
    const ownerUuid = "00000000-0000-4000-8000-000000000003";
    const sessionId = "attachment-persistence";
    createSessionRow(ownerUuid, sessionId, 1, "test");
    const data = new Uint8Array([1, 2, 3]);
    const attachment = createImageAttachment({
      ownerUuid,
      sessionId,
      name: image.name,
      mimeType: image.mimeType,
      data,
    });
    const row = getAttachment(ownerUuid, attachment.id)!;
    appendRuntimeMessage(ownerUuid, sessionId, {
      role: "user",
      content: "pasted image",
      attachments: [row],
    });
    const read = () =>
      getDb()
        .query(
          "SELECT attachments FROM messages WHERE session_id = ? AND position = 0",
        )
        .get(sessionId);
    expect(read()).toEqual({ attachments: JSON.stringify([attachment]) });
    expect(getAttachment(ownerUuid, attachment.id)?.data).toEqual(data);
  } finally {
    resetDbConnection();
  }
});
