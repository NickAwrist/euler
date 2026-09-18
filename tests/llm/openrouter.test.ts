import "../setup";
import { beforeEach, describe, expect, test } from "bun:test";
import { RunContext } from "../../src/RunContext";
import { BaseAgent } from "../../src/agents/BaseAgent";
import { setOpenRouterApiKey } from "../../src/db";
import { streamOpenRouterChat } from "../../src/llm/openRouterProvider";
import type { LlmStreamChunk } from "../../src/llm/types";
import {
  getOpenRouterRequests,
  resetOpenRouterScenario,
  setOpenRouterScenario,
} from "../helpers/mockOpenRouter";

const model = "openai/gpt-5.4-mini";

beforeEach(() => {
  resetOpenRouterScenario();
});

async function collect(): Promise<LlmStreamChunk[]> {
  const stream = await streamOpenRouterChat({
    model,
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
  });
  const chunks: LlmStreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("OpenRouter provider", () => {
  test("streams content, usage, and authenticated provider metadata", async () => {
    setOpenRouterApiKey("sk-or-secret-test");
    const chunks = await collect();
    expect(chunks.map((chunk) => chunk.contentDelta ?? "").join("")).toBe(
      "Hello from OpenRouter.",
    );
    expect(chunks.at(-1)?.metrics).toMatchObject({
      cost: 0.00042,
      promptTokens: 10,
      outputTokens: 5,
    });
    expect(chunks.at(-1)?.metrics?.outputDurationMs).toBeGreaterThan(0);
    expect(chunks.at(-1)?.metrics?.tokensPerSecond).toBeGreaterThan(0);

    const request = getOpenRouterRequests()[0]!;
    expect(request.headers.get("authorization")).toBe(
      "Bearer sk-or-secret-test",
    );
    expect(request.body.model).toBe(model);
    expect(request.body.stream).toBeTrue();
    expect(JSON.stringify(request.body)).not.toContain("sk-or-secret-test");
  });

  test("converts typed images to OpenRouter content parts", async () => {
    setOpenRouterApiKey("sk-or-image-test");
    const stream = await streamOpenRouterChat({
      model,
      messages: [
        {
          role: "user",
          content: "Describe this image",
          images: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              kind: "image",
              name: "sample.png",
              mimeType: "image/png",
              size: 3,
              data: "YWJj",
            },
          ],
        },
      ],
      tools: [],
    });
    for await (const _chunk of stream) {
      // Consume the response so the request is captured.
    }

    const messages = getOpenRouterRequests()[0]!.body.messages;
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,YWJj" },
          },
        ],
      },
    ]);
  });

  test("normalizes reasoning fields and split thinking tags", async () => {
    setOpenRouterApiKey("sk-or-test");
    setOpenRouterScenario("reasoning");
    let chunks = await collect();
    expect(chunks.map((chunk) => chunk.thinkingDelta ?? "").join("")).toBe(
      "Checking assumptions. Comparing options.",
    );
    expect(
      chunks.flatMap((chunk) => chunk.reasoningDetails ?? []),
    ).toHaveLength(1);
    expect(chunks.at(-1)?.reasoningDetails).toEqual([
      {
        type: "reasoning.summary",
        summary: "Comparing options.",
        id: "reasoning-1",
        format: "test",
        index: 0,
      },
    ]);

    setOpenRouterScenario("thinking-tags");
    chunks = await collect();
    expect(chunks.map((chunk) => chunk.thinkingDelta ?? "").join("")).toBe(
      "Private thought",
    );
    expect(chunks.map((chunk) => chunk.contentDelta ?? "").join("")).toBe(
      "Public answer",
    );
  });

  test("assembles tool fragments and preserves tool_call_id in the loop", async () => {
    setOpenRouterApiKey("sk-or-test");
    setOpenRouterScenario("tool-loop");
    const agent = new BaseAgent(
      "test_agent",
      "Test agent",
      [],
      `openrouter:${model}`,
      "Be concise.",
    );
    const context = new RunContext(agent, "Use a tool");

    expect(await agent.run("Use a tool", context)).toBe("Finished after tool.");
    const requests = getOpenRouterRequests();
    expect(requests).toHaveLength(2);
    const secondMessages = requests[1]!.body.messages as Array<
      Record<string, unknown>
    >;
    expect(secondMessages.at(-1)).toEqual({
      role: "tool",
      content: "Error: tool missing_tool not found",
      tool_call_id: "call_test_1",
    });
    const assistantMessage = secondMessages.find(
      (message) => message.role === "assistant",
    );
    expect(assistantMessage?.reasoning_details).toEqual([
      {
        type: "reasoning.summary",
        summary: "I should use a tool.",
        id: "tool-reasoning-1",
        format: "test",
        index: 0,
      },
    ]);
    expect(assistantMessage?.reasoning).toBeUndefined();
    expect(
      agent.history.some(
        (message) =>
          message.reasoning !== undefined ||
          message.reasoning_details !== undefined,
      ),
    ).toBeFalse();
  });

  test("surfaces provider and stream errors without leaking the key", async () => {
    setOpenRouterApiKey("sk-or-do-not-leak");
    setOpenRouterScenario("unauthorized");
    expect(collect()).rejects.toThrow("Invalid API key");

    setOpenRouterScenario("corrupted-stream");
    expect(collect()).rejects.toThrow("invalid streaming response");
  });

  test("configures reasoning effort in payload when specified", async () => {
    setOpenRouterApiKey("sk-or-test");
    const stream = await streamOpenRouterChat({
      model,
      messages: [{ role: "user", content: "Solve this" }],
      tools: [],
      reasoningEffort: "high",
    });
    for await (const _chunk of stream) {
    }
    const req = getOpenRouterRequests().at(-1)!;
    expect(req.body.reasoning).toEqual({ effort: "high", enabled: true });

    const streamOff = await streamOpenRouterChat({
      model,
      messages: [{ role: "user", content: "Solve this" }],
      tools: [],
      reasoningEffort: "off",
    });
    for await (const _chunk of streamOff) {
    }
    const reqOff = getOpenRouterRequests().at(-1)!;
    expect(reqOff.body.reasoning).toEqual({ enabled: false, effort: "none" });

    const streamOn = await streamOpenRouterChat({
      model,
      messages: [{ role: "user", content: "Solve this" }],
      tools: [],
      reasoningEffort: "on",
    });
    for await (const _chunk of streamOn) {
    }
    const reqOn = getOpenRouterRequests().at(-1)!;
    expect(reqOn.body.reasoning).toEqual({ enabled: true });
  });
});
