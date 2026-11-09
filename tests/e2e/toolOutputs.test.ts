import { waitForActivation } from "../helpers/activation";
import "../setup";
import { describe, expect, spyOn, test } from "bun:test";
import type WebSocket from "ws";
import { ComfyUIClient } from "../../src/comfyui/client";
import {
  setBraveSearchApiKey,
  setComfyUIHost,
  setOpenRouterApiKey,
} from "../../src/db";
import { Message_Role } from "../../src/gen/euler/v1/sessions_pb";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { rpc } from "../helpers/rpc";

const model = "openrouter:openai/gpt-5.6-terra";

describe("tool outputs", () => {
  test("attaches generated images and search sources to the persisted reply", async () => {
    setOpenRouterApiKey("sk-or-tool-outputs-test");
    setOpenRouterScenario("tool-outputs");
    setComfyUIHost("http://comfyui.test");
    setBraveSearchApiKey("brave-tool-outputs-test");
    const connect = spyOn(
      ComfyUIClient.prototype,
      "connectWebSocket",
    ).mockResolvedValue({} as WebSocket);
    const wait = spyOn(
      ComfyUIClient.prototype,
      "waitForPrompt",
    ).mockResolvedValue([
      { filename: "agents_00001_.png", subfolder: "", type: "output" },
    ]);
    const { sessions, agent } = rpc();
    const run = async (sessionId: string, content: string) => {
      await agent.sendMessage({ sessionId, content, settings: { model } });
      await waitForActivation(sessionId);
    };
    const storedHistory = async (id: string) =>
      (await sessions.getSession({ id })).session?.history ?? [];
    try {
      const { id: sessionId } = await sessions.createSession({ model });
      await run(sessionId, "Draw and research");
      // The scenario searches twice for the same query; its source is kept once.
      const expected = [
        {
          kind: {
            case: "generatedImage",
            value: { url: "/api/comfyui/view/agents_00001_.png?type=output" },
          },
        },
        {
          kind: {
            case: "webSource",
            value: {
              title: "Mocked Search Result 1",
              url: "https://example.com/result1",
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

      await run(sessionId, "Thanks");
      const [, firstReply] = await storedHistory(sessionId);
      expect(firstReply?.attachments).toMatchObject(expected);
      expect(firstReply?.attachments).toHaveLength(2);
    } finally {
      connect.mockRestore();
      wait.mockRestore();
    }
  });
});
