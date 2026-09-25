import "../setup";
import { describe, expect, spyOn, test } from "bun:test";
import type WebSocket from "ws";
import type { MessageAttachment } from "../../src/attachments/types";
import { ComfyUIClient } from "../../src/comfyui/client";
import {
  setComfyUIHost,
  setOpenRouterApiKey,
  setSearXNGHost,
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
    setSearXNGHost("http://searxng.test");
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
    const run = (sessionId: string, message: string, history: unknown[]) =>
      fetch(`${url}/api/runs`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ sessionId, message, history, model }),
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

      const response = await run(sessionId, "Draw and research", []);
      expect(response.status).toBe(200);
      const done = (await response.text())
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
        .find((event) => event.type === "run_done");

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
      expect(done?.attachments).toEqual(expected);
      const history = await storedHistory(sessionId);
      expect(history.at(-1)).toMatchObject({
        role: "assistant",
        content: "Here is the lighthouse and my sources.",
        attachments: expected,
      });

      const followUp = await run(sessionId, "Thanks", history);
      expect(followUp.status).toBe(200);
      expect(await followUp.text()).toContain('"type":"run_done"');
      expect((await storedHistory(sessionId))[1]?.attachments).toEqual(
        expected,
      );
    } finally {
      connect.mockRestore();
      wait.mockRestore();
      await close();
    }
  });
});
