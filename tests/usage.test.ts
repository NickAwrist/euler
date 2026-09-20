import { expect, test } from "bun:test";
import { getDb } from "../src/db/connection";
import { getUsageDashboard, recordUsage } from "../src/db/usage";
import { UsageQuery } from "../src/usage";

const now = 1800000000000;
function insert(
  model: string,
  timestamp: number,
  input: number,
  cost: number | null,
  owner = "alice",
  cached: number | null = 0,
) {
  getDb().run(
    "INSERT INTO usage_events (owner_uuid, model, timestamp, input, output, cached, cost, savings) VALUES (?, ?, ?, ?, 10, ?, ?, NULL)",
    [owner, model, timestamp, input, cached, cost],
  );
}
const query = (params: Record<string, unknown> = {}) =>
  UsageQuery.parse({ asOf: now, ...params });

test("SQL aggregates preserve missing metrics, zero local cost, provider filtering, and user/date boundaries", () => {
  insert("openrouter:a", now - 1000, 100, 0.5, "alice", 80);
  insert("local", now - 1000, 200, 0, "alice", null);
  insert("openrouter:a", now - 1000, 999, 999, "bob");
  insert("openrouter:a", now + 1, 999, 999);
  insert("openrouter:a", now - 8 * 86400000, 999, 999);
  const data = getUsageDashboard("alice", query(), now);
  expect(data.totals).toMatchObject({
    calls: 2,
    tokens: 320,
    input: 300,
    output: 20,
    cached: 80,
    uncached: 20,
    cost: 0.5,
    savings: null,
    cacheHitRate: 80,
  });
  expect(data.breakdown.rows.find((row) => row.key === "local")?.cost).toBe(0);
  expect(
    data.chart.series.flatMap((row) => row.tokens).reduce((a, b) => a + b, 0),
  ).toBe(320);
  const filtered = getUsageDashboard(
    "alice",
    query({ providers: ["ollama"] }),
    now,
  );
  expect(filtered.totals.calls).toBe(1);
  expect(filtered.providers).toHaveLength(2);
  expect(filtered.chart.series).toHaveLength(1);
  expect(filtered.breakdown.rows[0]?.tokenShare).toBe(100);
  expect(getUsageDashboard("nobody", query(), now).totals).toMatchObject({
    calls: 0,
    tokens: 0,
    cost: null,
  });
});

test("SQL sorts the entire hourly result before pagination and clamps pages", () => {
  for (let i = 0; i < 120; i++)
    insert("openrouter:a", now - i * 3600000, 100, i);
  const options = query({
    grouping: "hour",
    sorting: JSON.stringify([{ column: "spend", direction: "descending" }]),
  });
  const first = getUsageDashboard("alice", options, now);
  const second = getUsageDashboard("alice", { ...options, page: 1 }, now);
  expect(first.breakdown.totalRows).toBe(120);
  expect(first.breakdown.rows).toHaveLength(50);
  expect(first.breakdown.rows[0]?.cost).toBe(119);
  expect(second.breakdown.rows[0]?.cost).toBe(69);
  expect(first.totals).toEqual(second.totals);
  expect(
    new Set(
      [...first.breakdown.rows, ...second.breakdown.rows].map((row) => row.key),
    ).size,
  ).toBe(100);
  expect(
    getUsageDashboard("alice", { ...options, page: 999 }, now).breakdown.rows,
  ).toHaveLength(20);
  const time = getUsageDashboard(
    "alice",
    { ...options, sorting: [{ column: "name", direction: "descending" }] },
    now,
  );
  expect(time.breakdown.rows[0]?.timestamp).toBe(
    Math.floor(now / 3600000) * 3600000,
  );
});

test("SQL multi-column sorting resolves ties and keeps unknown costs last in either direction", () => {
  for (const [model, input, cost] of [
    ["b", 20, 1],
    ["a", 20, 1],
    ["c", 30, 1],
    ["d", 10, 2],
    ["unknown", 100, null],
  ] as const)
    insert(`openrouter:${model}`, now, input, cost);
  const options = query({
    sorting: JSON.stringify([
      { column: "spend", direction: "descending" },
      { column: "tokens", direction: "descending" },
      { column: "name", direction: "ascending" },
    ]),
  });
  expect(
    getUsageDashboard("alice", options, now).breakdown.rows.map(
      (row) => row.key,
    ),
  ).toEqual(
    ["d", "c", "a", "b", "unknown"].map((name) => `openrouter:${name}`),
  );
  options.sorting[0]!.direction = "ascending";
  expect(
    getUsageDashboard("alice", options, now).breakdown.rows.map(
      (row) => row.key,
    ),
  ).toEqual(
    ["c", "a", "b", "d", "unknown"].map((name) => `openrouter:${name}`),
  );
});

test("invalid metrics remain unknown and cache counts cannot exceed input", () => {
  recordUsage("alice", "openrouter:test/model", {
    promptTokens: 10,
    cachedTokens: 100,
    cost: Number.NaN,
    outputTokens: -1,
  });
  expect(getUsageDashboard("alice", UsageQuery.parse({})).totals).toMatchObject(
    { cached: 10, cost: null, output: null },
  );
});

test("API query schema rejects invalid page sizes, windows and unsafe sort columns", () => {
  for (const invalid of [
    { days: 365 },
    { page: -1 },
    { page: 1.5 },
    { grouping: "raw" },
    { sorting: "invalid" },
    {
      sorting: JSON.stringify([
        { column: "cost; DROP TABLE usage_events", direction: "descending" },
      ]),
    },
  ])
    expect(UsageQuery.safeParse(invalid).success).toBe(false);
});

test("high call volume produces a bounded aggregate response", () => {
  getDb().run(
    `WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n < 20000)
    INSERT INTO usage_events (owner_uuid,model,timestamp,input,output,cached,cost)
    SELECT 'alice','openrouter:volume',?,100,10,80,0.001 FROM numbers`,
    [now],
  );
  const data = getUsageDashboard("alice", query({ grouping: "hour" }), now);
  expect(data.totals.calls).toBe(20000);
  expect(data.totals.tokens).toBe(2200000);
  expect(data.breakdown.rows).toHaveLength(1);
  expect(JSON.stringify(data).length).toBeLessThan(4000);
});

test("every summary follows the period and all time includes older history with a bounded chart", () => {
  insert("openrouter:a", now - 3600000, 100, 1, "alice", 20);
  insert("openrouter:a", now - 3 * 86400000, 300, 2, "alice", 240);
  insert("openrouter:b", now - 1000 * 86400000, 600, 3, "alice", 600);
  getDb().run("UPDATE usage_events SET savings = cost / 10");
  const day = getUsageDashboard("alice", query({ days: 1 }), now);
  const week = getUsageDashboard("alice", query({ days: 7 }), now);
  const all = getUsageDashboard(
    "alice",
    query({ days: 0, grouping: "hour" }),
    now,
  );
  expect(day.totals).toMatchObject({
    calls: 1,
    tokens: 110,
    cached: 20,
    uncached: 80,
    output: 10,
    cost: 1,
    savings: 0.1,
    cacheHitRate: 20,
  });
  expect(week.totals).toMatchObject({
    calls: 2,
    tokens: 420,
    cached: 260,
    uncached: 140,
    output: 20,
    cost: 3,
    cacheHitRate: 65,
  });
  expect(all.totals).toMatchObject({
    calls: 3,
    tokens: 1030,
    cached: 860,
    uncached: 140,
    output: 30,
    cost: 6,
    cacheHitRate: 86,
  });
  expect(all.totals.savings).toBeCloseTo(0.6);
  expect(all.chart.series).toHaveLength(2);
  expect(week.breakdown.rows[0]?.calls).toBe(2);
  expect(day.breakdown.rows[0]?.calls).toBe(1);
  expect(all.chart.buckets.length).toBeLessThanOrEqual(91);
  expect(all.chart.intervalMs).toBeGreaterThan(86400000);
  expect(
    all.chart.series.flatMap((item) => item.tokens).reduce((a, b) => a + b, 0),
  ).toBe(1030);
  expect(
    all.breakdown.rows.reduce((sum, row) => sum + row.tokenShare, 0),
  ).toBeCloseTo(100);
});

test("provider filters include every model from that provider without combining model breakdown rows", () => {
  insert("openrouter:anthropic/sonnet", now - 1000, 100, 1);
  insert("openrouter:anthropic/opus", now - 2000, 200, 2);
  insert("openrouter:openai/gpt", now - 1000, 400, 4);
  const result = getUsageDashboard(
    "alice",
    query({ providers: ["anthropic"] }),
    now,
  );
  expect(
    result.providers.find((item) => item.key === "anthropic"),
  ).toMatchObject({ modelCount: 2, calls: 2, tokens: 320, cost: 3 });
  expect(result.providers).toHaveLength(2);
  expect(result.totals).toMatchObject({ calls: 2, tokens: 320, cost: 3 });
  expect(result.breakdown.rows.map((item) => item.key).sort()).toEqual([
    "openrouter:anthropic/opus",
    "openrouter:anthropic/sonnet",
  ]);
  expect(result.chart.series.map((item) => item.model).sort()).toEqual([
    "openrouter:anthropic/opus",
    "openrouter:anthropic/sonnet",
  ]);
  const hourly = getUsageDashboard(
    "alice",
    query({ providers: ["anthropic"], grouping: "hour" }),
    now,
  );
  expect(hourly.totals.tokens).toBe(320);
  expect(hourly.breakdown.rows[0]?.tokens).toBe(320);
});

test("provider combinations filter all aggregates and preserve the unfiltered provider list", () => {
  insert("openrouter:anthropic/sonnet", now - 1000, 100, 1);
  insert("openrouter:anthropic/opus", now - 2000, 200, 2);
  insert("openrouter:openai/gpt", now - 1000, 400, 4);
  insert("openrouter:google/gemini", now - 1000, 800, 8);
  const options = query({ providers: ["anthropic", "openai", "anthropic"] });
  expect(options.providers).toEqual(["anthropic", "openai"]);
  const data = getUsageDashboard("alice", options, now);
  expect(data.totals).toMatchObject({ calls: 3, tokens: 730, cost: 7 });
  expect(data.providers).toHaveLength(3);
  expect(data.breakdown.rows).toHaveLength(3);
  expect(data.chart.series).toHaveLength(3);
  expect(
    data.chart.series.flatMap((item) => item.tokens).reduce((a, b) => a + b, 0),
  ).toBe(730);
  expect(
    data.breakdown.rows.reduce((sum, item) => sum + item.tokenShare, 0),
  ).toBeCloseTo(100);
  expect(
    getUsageDashboard("alice", { ...options, grouping: "hour" }, now).breakdown
      .rows[0]?.tokens,
  ).toBe(730);
  expect(
    getUsageDashboard(
      "alice",
      query({ providers: ["anthropic') OR 1=1 --"] }),
      now,
    ).totals.calls,
  ).toBe(0);
  expect(
    getUsageDashboard("alice", query({ providers: [] }), now).totals.calls,
  ).toBe(4);
});
