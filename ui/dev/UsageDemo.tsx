import { useCallback, useState } from "react";
import type {
  UsageDashboard,
  UsageGroup,
  UsageQuery,
  UsageTotals,
} from "../../src/usage";
import { UsagePage } from "../components/UsagePage";
import { provider } from "../components/UsagePage/display";

// Synthetic, already-aggregated API responses for isolated UI tests.
const emptyTotals: UsageTotals = {
  calls: 0,
  tokens: 0,
  input: null,
  output: null,
  cached: null,
  uncached: null,
  cost: null,
  savings: null,
  cacheHitRate: null,
};
const names = [
  "openrouter:openai/gpt-5.4",
  "openrouter:anthropic/claude-sonnet-4.6",
  "openrouter:anthropic/claude-opus-4.6",
  "openrouter:google/gemini-3.1-pro",
  "openrouter:deepseek/deepseek-v3.2",
  "openrouter:qwen/qwen3.5",
  "openrouter:mistralai/mistral-large",
  "qwen3:8b",
];
const baseModels: UsageGroup[] = names.map((key, i) => ({
  key,
  timestamp: 0,
  calls: 168,
  tokens: (names.length - i) * 100000,
  input: (names.length - i) * 90000,
  output: (names.length - i) * 10000,
  cached: i === names.length - 1 ? null : (names.length - i) * 70000,
  uncached: i === names.length - 1 ? null : (names.length - i) * 20000,
  cost: i === names.length - 1 ? 0 : (names.length - i) * 0.6,
  savings: i === names.length - 1 ? null : (names.length - i) * 1.2,
  cacheHitRate: i === names.length - 1 ? null : 77.78,
  tokenShare:
    ((names.length - i) / ((names.length * (names.length + 1)) / 2)) * 100,
}));
function response(query: UsageQuery, empty: boolean): UsageDashboard {
  const asOf = query.asOf ?? Date.now();
  const rangeDays = query.days || 365;
  const factor = rangeDays / 7;
  const models = baseModels.map((model) => {
    const input = Math.round(model.input! * factor);
    const output = Math.round(model.output! * factor);
    const cached =
      model.cached === null ? null : Math.round(model.cached * factor);
    return {
      ...model,
      calls: rangeDays * 24,
      input,
      output,
      tokens: input + output,
      cached,
      uncached: cached === null ? null : input - cached,
      cost: model.cost === null ? null : model.cost * factor,
      savings: model.savings === null ? null : model.savings * factor,
    };
  });
  const visible = empty
    ? []
    : models.filter(
        (model) =>
          !query.providers.length ||
          query.providers.includes(provider(model.key)),
      );
  const sum = (
    key: "input" | "output" | "cached" | "uncached" | "cost" | "savings",
  ) => {
    const values = visible
      .map((model) => model[key])
      .filter((value) => value !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const knownInput = visible
    .filter((model) => model.cached !== null)
    .reduce((sum, model) => sum + (model.input ?? 0), 0);
  const totals: UsageTotals = empty
    ? emptyTotals
    : {
        calls: visible.reduce((sum, model) => sum + model.calls, 0),
        tokens: visible.reduce((sum, model) => sum + model.tokens, 0),
        input: sum("input"),
        output: sum("output"),
        cached: sum("cached"),
        uncached: sum("uncached"),
        cost: sum("cost"),
        savings: sum("savings"),
        cacheHitRate: knownInput
          ? ((sum("cached") ?? 0) / knownInput) * 100
          : null,
      };
  const size =
    query.days === 1 ? 3600000 : query.days === 0 ? 5 * 86400000 : 86400000;
  const count = Math.ceil((rangeDays * 86400000) / size) + 1;
  const start = Math.floor(asOf / size) * size - (count - 1) * size;
  const buckets = Array.from({ length: count }, (_, i) => start + i * size);
  const hours = rangeDays * 24;
  const rows =
    query.grouping === "model"
      ? visible.map((model) => ({
          ...model,
          tokenShare: totals.tokens ? (model.tokens / totals.tokens) * 100 : 0,
        }))
      : empty
        ? []
        : Array.from({ length: hours }, (_, i) => ({
            ...totals,
            calls: totals.calls / hours,
            tokens: totals.tokens / hours,
            input: totals.input === null ? null : totals.input / hours,
            output: totals.output === null ? null : totals.output / hours,
            cached: totals.cached === null ? null : totals.cached / hours,
            uncached: totals.uncached === null ? null : totals.uncached / hours,
            cost: totals.cost === null ? null : totals.cost / hours,
            savings: totals.savings === null ? null : totals.savings / hours,
            tokenShare: 100 / hours,
            key: String(Math.floor(asOf / 3600000) * 3600000 - i * 3600000),
            timestamp: Math.floor(asOf / 3600000) * 3600000 - i * 3600000,
          }));
  rows.sort((a, b) => {
    for (const rule of query.sorting) {
      const column =
        rule.column === "name"
          ? query.grouping === "hour"
            ? "timestamp"
            : "key"
          : rule.column === "spend"
            ? "cost"
            : rule.column === "share"
              ? "tokens"
              : rule.column;
      const left = a[column];
      const right = b[column];
      if (left === null || right === null) {
        if (left !== right) return left === null ? 1 : -1;
        continue;
      }
      const comparison =
        typeof left === "string" && typeof right === "string"
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      if (comparison)
        return rule.direction === "ascending" ? comparison : -comparison;
    }
    return 0;
  });
  const page = Math.min(
    query.page,
    Math.max(0, Math.ceil(rows.length / 50) - 1),
  );
  const providers: UsageDashboard["providers"] = empty
    ? []
    : [...new Set(models.map((model) => provider(model.key)))].map((key) => {
        const items = models.filter((model) => provider(model.key) === key);
        const sum = (
          field:
            | "input"
            | "output"
            | "cached"
            | "uncached"
            | "cost"
            | "savings",
        ) => {
          const values = items
            .map((item) => item[field])
            .filter((value) => value !== null);
          return values.length ? values.reduce((a, b) => a + b, 0) : null;
        };
        return {
          key,
          timestamp: 0,
          modelCount: items.length,
          calls: items.reduce((sum, item) => sum + item.calls, 0),
          tokens: items.reduce((sum, item) => sum + item.tokens, 0),
          input: sum("input"),
          output: sum("output"),
          cached: sum("cached"),
          uncached: sum("uncached"),
          cost: sum("cost"),
          savings: sum("savings"),
          cacheHitRate: items[0]!.cacheHitRate,
          tokenShare: items.reduce((sum, item) => sum + item.tokenShare, 0),
        };
      });
  return {
    asOf,
    grouping: query.grouping,
    providers,
    totals,
    models: empty ? [] : models,
    chart: {
      intervalMs: size,
      buckets,
      series: visible.map((model, i) => {
        const weights = buckets.map((_, j) => Math.sin(j + i) + 1.1);
        const weight = weights.reduce((a, b) => a + b, 0);
        const tokens = weights.map((value) =>
          Math.floor((value / weight) * model.tokens),
        );
        tokens[tokens.length - 1]! +=
          model.tokens - tokens.reduce((a, b) => a + b, 0);
        return {
          model: model.key,
          tokens,
          spend: weights.map((value) => (value / weight) * (model.cost ?? 0)),
        };
      }),
    },
    breakdown: {
      rows: rows.slice(page * 50, (page + 1) * 50),
      page,
      pageSize: 50,
      totalRows: rows.length,
    },
  };
}
export default function UsageDemo() {
  const [empty, setEmpty] = useState(false);
  const loadUsage = useCallback(
    async (query: UsageQuery) => response(query, empty),
    [empty],
  );
  return (
    <>
      <button
        type="button"
        onClick={() => setEmpty((value) => !value)}
        style={{
          position: "fixed",
          bottom: 4,
          right: 8,
          zIndex: 5,
          fontSize: 12,
        }}
      >
        Toggle empty fixture
      </button>
      <UsagePage
        onBack={() => {
          window.location.href = "/";
        }}
        loadUsage={loadUsage}
      />
    </>
  );
}
