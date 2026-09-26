import "../setup";
import { expect, test } from "bun:test";
import { setOpenRouterApiKey } from "../../src/db";
import type { WireMessageInput } from "../../src/schemas/run";
import { startTestServer, userHeaders } from "../helpers/server";

const model = "openrouter:openai/gpt-5.6-terra";

test("a regenerated reply keeps the replies it replaced", async () => {
  setOpenRouterApiKey("sk-or-regenerate-test");
  const { url, close } = await startTestServer();
  const headers = userHeaders(undefined, {
    "Content-Type": "application/json",
  });
  const post = (path: string, body: unknown) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const storedHistory = async (sessionId: string) => {
    const stored = await fetch(`${url}/api/sessions/${sessionId}`, {
      headers: userHeaders(),
    });
    return ((await stored.json()) as { history: WireMessageInput[] }).history;
  };
  try {
    const created = await post("/api/sessions", { model });
    const { id: sessionId } = (await created.json()) as { id: string };
    const run = async (body: Record<string, unknown>) => {
      const response = await post("/api/runs", { sessionId, model, ...body });
      expect(response.status).toBe(200);
      await response.text();
      return storedHistory(sessionId);
    };

    const [, first] = await run({ message: "Hello", history: [] });
    expect(first?.versions).toBeUndefined();

    const regenerated = await run({
      message: "Hello",
      history: [],
      modelMessages: null,
      versions: [{ content: first!.content, steps: first!.steps }],
    });
    expect(regenerated).toHaveLength(2);
    expect(regenerated[1]?.versions).toEqual([
      { content: first!.content, steps: first!.steps },
    ]);

    // Later turns leave earlier versions in place.
    const continued = await run({ message: "Thanks", history: regenerated });
    expect(continued).toHaveLength(4);
    expect(continued[1]?.versions).toHaveLength(1);
    expect(continued[3]?.versions).toBeUndefined();
  } finally {
    await close();
  }
});
