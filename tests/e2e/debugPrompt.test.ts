import { agentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { waitForActivation } from "../helpers/activation";
import "../setup";
import { expect, test } from "bun:test";
import {
  createSessionRow,
  createSkillRow,
  setOpenRouterApiKey,
} from "../../src/db";
import { getOpenRouterRequests } from "../helpers/mockOpenRouter";
import { Code, rpc, rpcCode } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";

test("PreviewPrompt returns the server-rendered system prompt", async () => {
  const { debug } = rpc();
  // 1. Without metadata the prompt includes the date and core directives.
  const first = await debug.previewPrompt({});
  expect(first.systemPrompt).toContain("Current date:");
  expect(first.systemPrompt).toContain("<tool_format>");
  expect(first.systemPrompt).toContain("<agency>");

  // 2. includeCurrentDate: false omits the date.
  const second = await debug.previewPrompt({
    metadata: { includeCurrentDate: false },
  });
  expect(second.systemPrompt).not.toContain("Current date:");
  expect(second.systemPrompt).toContain("<tool_format>");

  // 3. Personal fields appear in the prompt.
  const third = await debug.previewPrompt({
    metadata: {
      name: "Alice",
      location: "Wonderland",
      preferredFormats: "markdown tables",
      includeCurrentDate: true,
    },
  });
  expect(third.systemPrompt).toContain("User name: Alice");
  expect(third.systemPrompt).toContain("Location: Wonderland");
  expect(third.systemPrompt).toContain(
    "Preferred response format: markdown tables",
  );
  expect(third.systemPrompt).toContain("Current date:");
});

for (const includeCurrentDate of [undefined, false]) {
  test(`run sends the same custom prompt as the preview with date ${includeCurrentDate === false ? "disabled" : "defaulted"}`, async () => {
    const { debug, agent } = rpc();
    setOpenRouterApiKey("sk-or-prompt-test");
    const id = crypto.randomUUID();
    createSessionRow(TEST_USER_ID, id, Date.now(), null);
    try {
      const skill = createSkillRow(TEST_USER_ID, {
        name: "prompt-check",
        description: "Check prompts",
        instructions: "Verify every instruction.",
        user_invocable: true,
        disable_model_invocation: false,
      });
      const message = "Use $prompt-check";
      const metadata = {
        systemPrompt:
          "Follow these instructions.\n{{PERSONALIZATION}}\n{{SESSION_DIRECTORY}}\n{{OS}}",
        includeCurrentDate,
      };
      const { systemPrompt } = await debug.previewPrompt({
        sessionId: id,
        message,
        metadata,
      });
      expect(systemPrompt).toContain(skill.instructions);
      expect(systemPrompt.includes("Current date:")).toBe(
        includeCurrentDate === undefined,
      );
      expect(systemPrompt).toStartWith("Follow these instructions.");
      expect(systemPrompt).toContain("<tool_format>");
      await agent.sendMessage({
        sessionId: id,
        content: message,
        settings: { metadata, model: "openrouter:openai/gpt-5.4-mini" },
      });
      await waitForActivation(id);
      expect(getOpenRouterRequests()).toHaveLength(1);
      const messages = getOpenRouterRequests()[0]!.body.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0]).toEqual({ role: "system", content: systemPrompt });
    } finally {
      await agentRuntime.deleteSession(TEST_USER_ID, id);
    }
  });
}

test("debug preview rejects unknown and other users' chats", async () => {
  const { sessions } = rpc();
  const { id } = await sessions.createSession({});
  expect(
    await rpcCode(rpc().debug.previewPrompt({ sessionId: "missing-session" })),
  ).toBe(Code.NotFound);
  expect(
    await rpcCode(
      rpc("22222222-2222-4222-8222-222222222222").debug.previewPrompt({
        sessionId: id,
      }),
    ),
  ).toBe(Code.NotFound);
  expect(await rpcCode(rpc().debug.previewPrompt({ sessionId: "" }))).toBe(
    Code.InvalidArgument,
  );
});
