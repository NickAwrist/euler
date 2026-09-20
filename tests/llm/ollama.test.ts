import "../setup";
import { expect, test } from "bun:test";
import { setOllamaHost } from "../../src/db";
import { getUsageDashboard, recordUsage } from "../../src/db/usage";
import { streamOllamaChat } from "../../src/llm/ollamaProvider";
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
