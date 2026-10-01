import { waitForActivation } from "../helpers/activation";
import "../setup";
import { describe, expect, spyOn, test } from "bun:test";
import type WebSocket from "ws";
import type { MessageAttachment } from "../../src/attachments/types";
import { ComfyUIClient } from "../../src/comfyui/client";
import {
  setBraveSearchApiKey,
  setComfyUIHost,
  setOpenRouterApiKey,
} from "../../src/db";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { startTestServer, userHeaders } from "../helpers/server";

const model = "openrouter:openai/gpt-5.6-terra";

type StoredMessage = {
  role: string;
  content: string;
  attachments?: MessageAttachment[];
};

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
    const { url, close } = await startTestServer();
    const run = (sessionId: string, message: string) =>
      fetch(`${url}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ content: message, model }),
      });
    const storedHistory = async (sessionId: string) => {
      const stored = await fetch(`${url}/api/sessions/${sessionId}`, {
        headers: userHeaders(),
      });
      return ((await stored.json()) as { history: StoredMessage[] }).history;
    };
    try {
      const created = await fetch(`${url}/api/sessions`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ model }),
      });
      const { id: sessionId } = (await created.json()) as { id: string };

      const response = await run(sessionId, "Draw and research");
      expect(response.status).toBe(202);
      await waitForActivation(sessionId);
      // The scenario searches twice for the same query; its source is kept once.
      const expected: MessageAttachment[] = [
        {
          kind: "generated_image",
          url: "/api/comfyui/view/agents_00001_.png?type=output",
        },
        {
          kind: "web_source",
          title: "Mocked Search Result 1",
          url: "https://example.com/result1",
        },
      ];
      const history = await storedHistory(sessionId);
      expect(history.at(-1)).toMatchObject({
        role: "assistant",
        content: "Here is the lighthouse and my sources.",
        attachments: expected,
      });

      const followUp = await run(sessionId, "Thanks");
      expect(followUp.status).toBe(202);
      await waitForActivation(sessionId);
      const [, firstReply] = await storedHistory(sessionId);
      expect(firstReply?.attachments).toEqual(expected);
    } finally {
      connect.mockRestore();
      wait.mockRestore();
      await close();
    }
  });
});
