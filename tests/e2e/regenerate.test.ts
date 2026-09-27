import { waitForActivation } from "../helpers/activation";
import "../setup";
import { expect, test } from "bun:test";
import { setOpenRouterApiKey } from "../../src/db";
import type { WireMessageInput } from "../../src/schemas/run";
import { getOpenRouterRequests } from "../helpers/mockOpenRouter";
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
      const response = await post(`/api/sessions/${sessionId}/messages`, {
        model,
        content: body.message,
      });
      expect(response.status).toBe(202);
      await waitForActivation(sessionId);
      return storedHistory(sessionId);
    };

    const [, first] = await run({ message: "Hello", history: [] });
    expect(first?.versions).toBeUndefined();

    expect(
      (
        await post(`/api/sessions/${sessionId}/rewind`, {
          position: 0,
          content: "Hello",
          versions: [{ content: first!.content, steps: first!.steps }],
          model: "openrouter:anthropic/claude-sonnet-5",
          reasoningEffort: "high",
        })
      ).status,
    ).toBe(200);
    await waitForActivation(sessionId);
    // A regenerated reply uses the settings it was requested with.
    expect(getOpenRouterRequests().at(-1)?.body).toMatchObject({
      model: "anthropic/claude-sonnet-5",
      reasoning: { effort: "high" },
    });
    const session = await fetch(`${url}/api/sessions/${sessionId}`, {
      headers: userHeaders(),
    });
    expect(((await session.json()) as { model: string }).model).toBe(
      "openrouter:anthropic/claude-sonnet-5",
    );
    const regenerated = await storedHistory(sessionId);
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
