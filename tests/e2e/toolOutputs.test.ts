import { describe, expect, test } from "bun:test";
import { setBraveSearchApiKey, setOpenRouterApiKey } from "../../src/db";
import { Message_Role } from "../../src/gen/euler/v1/sessions_pb";
import { waitForActivation } from "../helpers/activation";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { rpc } from "../helpers/rpc";

const model = "openrouter:openai/gpt-5.6-terra";

describe("tool outputs", () => {
  test("attaches deduplicated search sources to the persisted reply", async () => {
    setOpenRouterApiKey("sk-or-tool-outputs-test");
    setOpenRouterScenario("tool-outputs");
    setBraveSearchApiKey("brave-tool-outputs-test");
    const { sessions, agent, attachments } = rpc();
    const run = async (sessionId: string, content: string) => {
      await agent.sendMessage({ sessionId, content, settings: { model } });
      await waitForActivation(sessionId);
    };
    const storedHistory = async (id: string) =>
      (await sessions.getSession({ id })).session?.history ?? [];
    const { id: sessionId } = await sessions.createSession({ model });
    await run(sessionId, "Research lighthouses");
    // The scenario searches twice for the same query (kept once) and generates an image.
    const expected = [
      {
        kind: {
          case: "webSource",
          value: {
            title: "Mocked Search Result 1",
            url: "https://example.com/result1",
          },
        },
      },
      {
        kind: {
          case: "image",
          value: {
            name: "a-lighthouse.png",
            mimeType: "image/png",
          },
        },
      },
    ];
    const history = await storedHistory(sessionId);
    expect(history.at(-1)).toMatchObject({
      role: Message_Role.ASSISTANT,
      content: "Here is the lighthouse and my sources.",
      attachments: expected,
    });

    const imageAttachment = history
      .at(-1)
      ?.attachments.find((a) => a.kind.case === "image");
    expect(imageAttachment?.kind.case).toBe("image");
    if (imageAttachment?.kind.case === "image") {
      const data = await attachments.getAttachmentData({
        id: imageAttachment.kind.value.id,
      });
      expect(data.mimeType).toBe("image/png");
      expect(data.data.byteLength).toBeGreaterThan(0);
    }

    await run(sessionId, "Thanks");
    const [, firstReply] = await storedHistory(sessionId);
    expect(firstReply?.attachments).toMatchObject(expected);
    expect(firstReply?.attachments).toHaveLength(2);
  });
});
