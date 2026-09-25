import "../setup";
import { describe, expect, test } from "bun:test";
import type {
  ImageAttachment,
  MessageAttachment,
} from "../../src/attachments/types";
import { startTestServer, userHeaders } from "../helpers/server";

const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe("image attachments", () => {
  test("uploads, sends, persists, and protects an image", async () => {
    const { url, close } = await startTestServer();
    try {
      const created = await fetch(`${url}/api/sessions`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ model: "llama3:latest" }),
      });
      const { id: sessionId } = (await created.json()) as { id: string };

      const upload = await fetch(`${url}/api/attachments`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "image/png",
          "X-Euler-Session-ID": sessionId,
          "X-Attachment-Filename": encodeURIComponent("sample.png"),
        }),
        body: PNG_SIGNATURE,
      });
      expect(upload.status).toBe(201);
      const { attachment } = (await upload.json()) as {
        attachment: ImageAttachment;
      };
      expect(attachment).toMatchObject({
        kind: "image",
        name: "sample.png",
        mimeType: "image/png",
        size: PNG_SIGNATURE.byteLength,
      });

      const read = await fetch(`${url}/api/attachments/${attachment.id}`, {
        headers: userHeaders(),
      });
      expect(read.status).toBe(200);
      expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG_SIGNATURE);
      expect(
        (
          await fetch(`${url}/api/attachments/${attachment.id}`, {
            headers: userHeaders(OTHER_USER),
          })
        ).status,
      ).toBe(404);

      const run = await fetch(`${url}/api/runs`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          sessionId,
          message: "What is in this image?",
          history: [],
          model: "llama3:latest",
          attachmentIds: [attachment.id],
        }),
      });
      expect(run.status).toBe(200);
      expect(await run.text()).toContain('"type":"run_done"');

      const stored = await fetch(`${url}/api/sessions/${sessionId}`, {
        headers: userHeaders(),
      });
      const body = (await stored.json()) as {
        history: Array<{ attachments?: MessageAttachment[] }>;
        modelMessages: Array<Record<string, unknown>>;
      };
      expect(body.history[0]?.attachments).toEqual([attachment]);
      expect(body.modelMessages[0]?.images).toEqual([attachment]);
      expect(JSON.stringify(body.modelMessages)).not.toContain("iVBOR");
    } finally {
      await close();
    }
  });
});
