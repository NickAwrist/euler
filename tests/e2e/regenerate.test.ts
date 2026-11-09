import { waitForActivation } from "../helpers/activation";
import "../setup";
import { expect, test } from "bun:test";
import { setOpenRouterApiKey } from "../../src/db";
import { getOpenRouterRequests } from "../helpers/mockOpenRouter";
import { rpc } from "../helpers/rpc";

const model = "openrouter:openai/gpt-5.6-terra";

test("a regenerated reply keeps the replies it replaced", async () => {
  setOpenRouterApiKey("sk-or-regenerate-test");
  const { sessions, agent } = rpc();
  const storedHistory = async (id: string) =>
    (await sessions.getSession({ id })).session?.history ?? [];
  const { id: sessionId } = await sessions.createSession({ model });
  const run = async (content: string) => {
    await agent.sendMessage({ sessionId, content, settings: { model } });
    await waitForActivation(sessionId);
    return storedHistory(sessionId);
  };

  const [, first] = await run("Hello");
  expect(first?.versions).toEqual([]);

  await agent.rewind({
    sessionId,
    position: 0,
    content: "Hello",
    versions: [{ content: first!.content, steps: first!.steps }],
    settings: {
      model: "openrouter:anthropic/claude-sonnet-5",
      reasoningEffort: "high",
    },
  });
  await waitForActivation(sessionId);
  // A regenerated reply uses the settings it was requested with.
  expect(getOpenRouterRequests().at(-1)?.body).toMatchObject({
    model: "anthropic/claude-sonnet-5",
    reasoning: { effort: "high" },
  });
  expect((await sessions.getSession({ id: sessionId })).session?.model).toBe(
    "openrouter:anthropic/claude-sonnet-5",
  );
  const regenerated = await storedHistory(sessionId);
  expect(regenerated).toHaveLength(2);
  expect(regenerated[1]?.versions).toHaveLength(1);
  expect(regenerated[1]?.versions[0]).toMatchObject({
    content: first!.content,
    steps: first!.steps,
  });

  // Later turns leave earlier versions in place.
  const continued = await run("Thanks");
  expect(continued).toHaveLength(4);
  expect(continued[1]?.versions).toHaveLength(1);
  expect(continued[3]?.versions).toEqual([]);
});
