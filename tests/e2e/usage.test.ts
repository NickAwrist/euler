import "../setup";
import { expect, test } from "bun:test";
import { recordUsage } from "../../src/db/usage";
import { UsageGrouping } from "../../src/gen/euler/v1/usage_pb";
import { Code, rpc, rpcCode } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";

test("usage API returns aggregates and rejects invalid query parameters", async () => {
  recordUsage(TEST_USER_ID, "local", { promptTokens: 100, outputTokens: 20 });
  recordUsage("22222222-2222-4222-8222-222222222222", "local", {
    promptTokens: 900,
  });
  const { usage } = rpc();
  const data = await usage.getUsage({
    days: 7,
    grouping: UsageGrouping.HOUR,
  });
  expect(data.totals).toMatchObject({ calls: 1, tokens: 120, cost: 0 });
  expect(data.breakdown?.rows).toHaveLength(1);
  expect(data.chart?.series).toHaveLength(1);
  for (const request of [
    { days: 365 },
    { grouping: 9 as UsageGrouping },
    { sorting: [{ column: 0 }] },
    {
      sorting: [
        { column: 2, descending: true },
        { column: 2, descending: false },
      ],
    },
  ])
    expect(await rpcCode(usage.getUsage(request))).toBe(Code.InvalidArgument);
  expect(await rpcCode(rpc(null).usage.getUsage({ days: 7 }))).toBe(
    Code.InvalidArgument,
  );
});

test("usage API filters by one or several providers", async () => {
  recordUsage(TEST_USER_ID, "openrouter:anthropic/sonnet", {
    promptTokens: 100,
  });
  recordUsage(TEST_USER_ID, "openrouter:openai/gpt", { promptTokens: 200 });
  recordUsage(TEST_USER_ID, "openrouter:google/gemini", { promptTokens: 400 });
  const { usage } = rpc();
  for (const [providers, calls, tokens] of [
    [["anthropic"], 1, 100],
    [["anthropic", "openai"], 2, 300],
  ] as const) {
    const data = await usage.getUsage({ days: 7, providers: [...providers] });
    expect(data.totals).toMatchObject({ calls, tokens });
  }
});
