import { waitForActivation } from "../helpers/activation";
import "../setup";
import { describe, expect, test } from "bun:test";
import { Code, rpc, rpcCode } from "../helpers/rpc";

const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe("image attachments", () => {
  test("uploads, sends, persists, and protects an image", async () => {
    const api = rpc();
    const other = rpc(OTHER_USER);
    const { id: sessionId } = await api.sessions.createSession({
      model: "llama3:latest",
    });

    const { attachment } = await api.attachments.createAttachment({
      sessionId,
      filename: "folder/sample.png",
      mimeType: "image/png",
      data: PNG_SIGNATURE,
    });
    expect(attachment).toMatchObject({
      name: "sample.png",
      mimeType: "image/png",
      size: PNG_SIGNATURE.byteLength,
    });
    const id = attachment!.id;

    const read = await api.attachments.getAttachmentData({ id });
    expect(read.mimeType).toBe("image/png");
    expect(read.data).toEqual(PNG_SIGNATURE);
    expect(await rpcCode(other.attachments.getAttachmentData({ id }))).toBe(
      Code.NotFound,
    );
    expect(await rpcCode(other.attachments.deleteAttachment({ id }))).toBe(
      Code.NotFound,
    );

    // The declared type must match the bytes, and another user's chat is unknown.
    expect(
      await rpcCode(
        api.attachments.createAttachment({
          sessionId,
          filename: "fake.png",
          mimeType: "image/png",
          data: new TextEncoder().encode("not an image"),
        }),
      ),
    ).toBe(Code.InvalidArgument);
    expect(
      await rpcCode(
        other.attachments.createAttachment({
          sessionId,
          filename: "sample.png",
          mimeType: "image/png",
          data: PNG_SIGNATURE,
        }),
      ),
    ).toBe(Code.NotFound);
    expect(
      await rpcCode(
        api.attachments.createAttachment({
          sessionId,
          filename: "huge.png",
          mimeType: "image/png",
          data: new Uint8Array(8 * 1024 * 1024 + 1),
        }),
      ),
    ).toBe(Code.InvalidArgument);

    await api.agent.sendMessage({
      sessionId,
      content: "What is in this image?",
      attachmentIds: [id],
      settings: { model: "llama3:latest" },
    });
    await waitForActivation(sessionId);

    const { session } = await api.sessions.getSession({ id: sessionId });
    expect(session?.history[0]?.attachments).toMatchObject([
      { kind: { case: "image", value: attachment } },
    ]);
    const domain = {
      id,
      kind: "image",
      name: "sample.png",
      mimeType: "image/png",
      size: PNG_SIGNATURE.byteLength,
    };
    expect(session?.modelMessages[0]?.images).toEqual([domain]);
    expect(JSON.stringify(session?.modelMessages)).not.toContain("iVBOR");
  });
});
