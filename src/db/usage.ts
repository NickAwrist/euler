import type { LlmMetrics } from "../RunContext";
import {
  openRouterModelId,
  resolveModelSelection,
} from "../llm/modelSelection";
import { openRouterCatalog } from "../openRouterModels";
import type {
  UsageDashboard,
  UsageGroup,
  UsageQuery,
  UsageTotals,
} from "../usage";
import { getDb } from "./connection";

const valid = (value: number | undefined): number | null =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;

export function recordUsage(
  owner: string,
  model: string,
  metrics: LlmMetrics,
): void {
  const resolved = resolveModelSelection(model);
  const modelId =
    resolved.provider === "openrouter"
      ? openRouterModelId(resolved.model)
      : resolved.model;
  const input = valid(metrics.promptTokens);
  const output = valid(metrics.outputTokens);
  const rawCached = valid(metrics.cachedTokens);
  const cached =
    rawCached === null ? null : Math.min(rawCached, input ?? rawCached);
  const pricing = openRouterCatalog
    .peek()
    .models?.find((item) => `openrouter:${item.route}` === modelId);
  const savings =
    cached === 0
      ? 0
      : cached !== null &&
          pricing?.promptPricePerMillion != null &&
          pricing.cacheReadPricePerMillion != null
        ? (cached *
            Math.max(
              0,
              pricing.promptPricePerMillion - pricing.cacheReadPricePerMillion,
            )) /
          1_000_000
        : null;
  getDb().run(
    "INSERT INTO usage_events (owner_uuid, model, timestamp, input, output, cached, cost, savings) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      owner,
      modelId,
      Date.now(),
      input,
      output,
      cached,
      resolved.provider === "ollama" ? 0 : valid(metrics.cost),
      savings,
    ],
  );
}

// Aggregate in SQLite: individual call records never cross the API boundary.
const BASE = `WITH normalized AS (
  SELECT CASE WHEN model NOT LIKE 'openrouter:%' AND EXISTS
    (SELECT 1 FROM openrouter_models WHERE route = usage_events.model)
    THEN 'openrouter:' || model ELSE model END AS model,
    timestamp, input, output, cached, savings,
    CASE WHEN model NOT LIKE 'openrouter:%' AND NOT EXISTS
      (SELECT 1 FROM openrouter_models WHERE route = usage_events.model)
      THEN 0 ELSE cost END AS cost
  FROM usage_events WHERE owner_uuid = ? AND timestamp >= ? AND timestamp <= ?
), calls AS (
  SELECT normalized.*, CASE WHEN model LIKE 'openrouter:%'
    THEN CASE WHEN instr(substr(model, 12), '/') > 0
      THEN substr(model, 12, instr(substr(model, 12), '/') - 1)
      ELSE substr(model, 12) END
    ELSE 'ollama' END AS provider FROM normalized
)`;
const TOTALS = `COUNT(*) AS calls,
  COALESCE(SUM(COALESCE(input, 0) + COALESCE(output, 0)), 0) AS tokens,
  SUM(input) AS input, SUM(output) AS output, SUM(cached) AS cached,
  SUM(CASE WHEN cached IS NOT NULL THEN input - cached END) AS uncached,
  SUM(cost) AS cost, SUM(savings) AS savings,
  100.0 * SUM(CASE WHEN input IS NOT NULL THEN cached END) /
    NULLIF(SUM(CASE WHEN cached IS NOT NULL THEN input END), 0) AS cacheHitRate`;

export function getUsageDashboard(
  owner: string,
  query: UsageQuery,
  now = Date.now(),
): UsageDashboard {
  const db = getDb();
  const asOf = Math.min(query.asOf ?? now, now);
  const since = query.days === 0 ? 0 : asOf - query.days * 86400000;
  const args = [owner, since, asOf];
  const filter = query.providers.length
    ? ` WHERE provider IN (${query.providers.map(() => "?").join(", ")})`
    : "";
  const filteredArgs = [...args, ...query.providers];
  // A read transaction keeps totals, chart and paginated rows consistent.
  return db.transaction(() => {
    const totals = db
      .query(`${BASE} SELECT ${TOTALS} FROM calls${filter}`)
      .get(...filteredArgs) as UsageTotals;
    const models = db
      .query(
        `${BASE} SELECT model AS key, provider, 0 AS timestamp, ${TOTALS} FROM calls GROUP BY model ORDER BY tokens DESC, model`,
      )
      .all(...args) as (UsageGroup & { provider: string })[];
    const providers = db
      .query(`${BASE} SELECT provider AS key, 0 AS timestamp,
      COUNT(DISTINCT model) AS modelCount, ${TOTALS} FROM calls GROUP BY provider ORDER BY tokens DESC, provider`)
      .all(...args) as UsageDashboard["providers"];
    const allTokens = models.reduce((sum, model) => sum + model.tokens, 0);
    for (const model of [...models, ...providers])
      model.tokenShare = allTokens ? (model.tokens / allTokens) * 100 : 0;
    const group =
      query.grouping === "model" ? "model" : "(timestamp / 3600000) * 3600000";
    const count = db
      .query(
        `${BASE} SELECT COUNT(DISTINCT ${group}) AS count FROM calls${filter}`,
      )
      .get(...filteredArgs) as { count: number };
    const pageSize = 50;
    const page = Math.min(
      query.page,
      Math.max(0, Math.ceil(count.count / pageSize) - 1),
    );
    const columns = {
      name: query.grouping === "model" ? "key COLLATE NOCASE" : "timestamp",
      tokens: "tokens",
      share: "tokens",
      spend: "cost",
      cached: "cached",
      savings: "savings",
    };
    const order = query.sorting
      .map(
        (rule) =>
          `${columns[rule.column]} ${rule.direction === "ascending" ? "ASC" : "DESC"} NULLS LAST`,
      )
      .join(", ");
    const rows = db
      .query(`${BASE} SELECT CAST(${group} AS TEXT) AS key,
      ${query.grouping === "hour" ? group : "0"} AS timestamp, ${TOTALS}
      FROM calls${filter} GROUP BY ${group} ORDER BY ${order}, key ASC LIMIT ? OFFSET ?`)
      .all(...filteredArgs, pageSize, page * pageSize) as UsageGroup[];
    for (const row of rows)
      row.tokenShare = totals.tokens ? (row.tokens / totals.tokens) * 100 : 0;
    const first =
      query.days === 0
        ? ((
            db
              .query(
                `${BASE} SELECT MIN(timestamp) AS timestamp FROM calls${filter}`,
              )
              .get(...filteredArgs) as { timestamp: number | null }
          ).timestamp ?? asOf)
        : since;
    // All-time charts retain a bounded number of points regardless of history length.
    const size =
      query.days === 1
        ? 3600000
        : query.days === 0
          ? Math.max(1, Math.ceil((asOf - first + 1) / (90 * 86400000))) *
            86400000
          : 86400000;
    const firstBucket = Math.floor(first / size) * size;
    const start =
      firstBucket === Math.floor(asOf / size) * size
        ? firstBucket - size
        : firstBucket;
    const bucketCount = Math.floor((asOf - start) / size) + 1;
    const buckets = Array.from(
      { length: bucketCount },
      (_, i) => start + i * size,
    );
    const chartRows = db
      .query(`${BASE} SELECT model, (timestamp / ?) * ? AS bucket,
      COALESCE(SUM(COALESCE(input, 0) + COALESCE(output, 0)), 0) AS tokens,
      COALESCE(SUM(cost), 0) AS spend FROM calls${filter} GROUP BY model, bucket`)
      .all(...args, size, size, ...query.providers) as {
      model: string;
      bucket: number;
      tokens: number;
      spend: number;
    }[];
    const series = models
      .filter(
        (model) =>
          !query.providers.length || query.providers.includes(model.provider),
      )
      .map((model) => ({
        model: model.key,
        tokens: Array<number>(bucketCount).fill(0),
        spend: Array<number>(bucketCount).fill(0),
      }));
    const byModel = new Map(series.map((item) => [item.model, item]));
    for (const row of chartRows) {
      const item = byModel.get(row.model);
      const index = (row.bucket - start) / size;
      if (item && index >= 0 && index < bucketCount) {
        item.tokens[index] = row.tokens;
        item.spend[index] = row.spend;
      }
    }
    return {
      grouping: query.grouping,
      asOf,
      totals,
      models,
      providers,
      chart: { intervalMs: size, buckets, series },
      breakdown: { rows, page, pageSize, totalRows: count.count },
    };
  })();
}
