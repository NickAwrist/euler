import "../setup";
import { expect, test } from "bun:test";
import { setOllamaHost } from "../../src/db";
import { getUsageDashboard, recordUsage } from "../../src/db/usage";
import {
  ollamaReasoning,
  streamOllamaChat,
} from "../../src/llm/ollamaProvider";
import { UsageQuery } from "../../src/usage";

test("Ollama reports local tokens and zero API spend to usage tracking", async () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      new Response(
        `${JSON.stringify({ model: "qwen3:8b", message: { role: "assistant", content: "Hello" }, done: true, prompt_eval_count: 100, eval_count: 20 })}\n`,
        { headers: { "Content-Type": "application/x-ndjson" } },
      ),
  });
  try {
    setOllamaHost(`http://127.0.0.1:${server.port}`);
    const stream = await streamOllamaChat({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    });
    for await (const chunk of stream) {
      if (chunk.metrics) recordUsage("local-user", "qwen3:8b", chunk.metrics);
    }
    expect(
      getUsageDashboard("local-user", UsageQuery.parse({})).breakdown.rows,
    ).toMatchObject([{ key: "qwen3:8b", input: 100, output: 20, cost: 0 }]);
  } finally {
    server.stop(true);
  }
});

test("Ollama maps the selected thinking level to the think option", async () => {
  const thinks: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      thinks.push(((await req.json()) as { think?: unknown }).think);
      return new Response(
        `${JSON.stringify({ model: "m", message: { role: "assistant", content: "" }, done: true })}\n`,
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    },
  });
  try {
    setOllamaHost(`http://127.0.0.1:${server.port}`);
    for (const reasoningEffort of ["off", "on", "low", "xhigh", undefined]) {
      const stream = await streamOllamaChat({
        model: "m",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
        reasoningEffort,
      });
      for await (const _ of stream);
    }
    expect(thinks).toEqual([false, true, "low", undefined, undefined]);
  } finally {
    server.stop(true);
  }
});

test("Ollama thinking models get levels for gpt-oss and a toggle otherwise", () => {
  expect(ollamaReasoning(["completion", "tools"], "qwen3")).toBeUndefined();
  expect(ollamaReasoning(["thinking"], "qwen3moe")).toEqual({
    mandatory: false,
    defaultEnabled: true,
    supportedEfforts: [],
  });
  expect(ollamaReasoning(["thinking"], "gptoss")).toMatchObject({
    mandatory: true,
    supportedEfforts: ["low", "medium", "high"],
    defaultEffort: "medium",
  });
});
