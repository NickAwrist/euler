import "../setup";
import { expect, test } from "bun:test";
import { recordUsage } from "../../src/db/usage";
import type { UsageDashboard } from "../../src/usage";
import { TEST_USER_ID, startTestServer, userHeaders } from "../helpers/server";

test("usage API returns aggregates and rejects invalid query parameters", async () => {
  recordUsage(TEST_USER_ID, "local", { promptTokens: 100, outputTokens: 20 });
  recordUsage("22222222-2222-4222-8222-222222222222", "local", {
    promptTokens: 900,
  });
  const { url, close } = await startTestServer();
  try {
    const response = await fetch(`${url}/api/usage?days=7&grouping=hour`, {
      headers: userHeaders(),
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as UsageDashboard;
    expect(data.totals).toMatchObject({ calls: 1, tokens: 120, cost: 0 });
    expect(data.breakdown.rows).toHaveLength(1);
    expect(data.chart.series).toHaveLength(1);
    for (const params of [
      "days=365",
      "page=-1",
      "sorting=invalid",
      "grouping=raw",
    ]) {
      expect(
        (await fetch(`${url}/api/usage?${params}`, { headers: userHeaders() }))
          .status,
      ).toBe(400);
    }
    expect((await fetch(`${url}/api/usage`)).status).toBe(400);
  } finally {
    await close();
  }
});

test("usage API accepts single and repeated provider query parameters", async () => {
  recordUsage(TEST_USER_ID, "openrouter:anthropic/sonnet", {
    promptTokens: 100,
  });
  recordUsage(TEST_USER_ID, "openrouter:openai/gpt", { promptTokens: 200 });
  recordUsage(TEST_USER_ID, "openrouter:google/gemini", { promptTokens: 400 });
  const { url, close } = await startTestServer();
  try {
    for (const [params, calls, tokens] of [
      ["providers=anthropic", 1, 100],
      ["providers=anthropic&providers=openai", 2, 300],
    ] as const) {
      const response = await fetch(`${url}/api/usage?${params}`, {
        headers: userHeaders(),
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as UsageDashboard;
      expect(data.totals).toMatchObject({ calls, tokens });
    }
  } finally {
    await close();
  }
});
