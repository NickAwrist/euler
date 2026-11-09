import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromMs, timestampMs } from "@bufbuild/protobuf/wkt";
import type { SortColumn, UsageDashboard, UsageQuery, UsageTotals } from ".";
import {
  type GetUsageRequest,
  type GetUsageResponseSchema,
  UsageGrouping,
  UsageSortRule_Column,
} from "../gen/euler/v1/usage_pb";
import { OperationError } from "../observability/errors";
import { optionalMillis } from "../rpc/wire";

// Converts usage queries and dashboards to and from their GetUsage messages.

const COLUMNS: Record<number, SortColumn> = {
  [UsageSortRule_Column.NAME]: "name",
  [UsageSortRule_Column.TOKENS]: "tokens",
  [UsageSortRule_Column.SHARE]: "share",
  [UsageSortRule_Column.SPEND]: "spend",
  [UsageSortRule_Column.CACHED]: "cached",
  [UsageSortRule_Column.SAVINGS]: "savings",
};

const totals = (value: UsageTotals) => ({
  calls: value.calls,
  tokens: value.tokens,
  input: value.input ?? undefined,
  output: value.output ?? undefined,
  cached: value.cached ?? undefined,
  uncached: value.uncached ?? undefined,
  cost: value.cost ?? undefined,
  savings: value.savings ?? undefined,
  cacheHitRate: value.cacheHitRate ?? undefined,
});

/** The dashboard query a request asks for. */
export function usageQuery(request: GetUsageRequest): UsageQuery {
  const sorting = request.sorting.map((rule) => ({
    column: COLUMNS[rule.column] ?? "spend",
    direction: rule.descending
      ? ("descending" as const)
      : ("ascending" as const),
  }));
  if (new Set(sorting.map((rule) => rule.column)).size !== sorting.length)
    throw new OperationError("INVALID_REQUEST", {
      message: "Sort by each column at most once",
    });
  return {
    days: request.days,
    grouping: request.grouping === UsageGrouping.HOUR ? "hour" : "model",
    providers: request.providers,
    page: request.page,
    asOf: request.asOf ? timestampMs(request.asOf) : undefined,
    sorting: sorting.length
      ? sorting
      : [{ column: "spend", direction: "descending" }],
  };
}

/** A usage dashboard as GetUsage returns it. */
export function usageResponse(
  dashboard: UsageDashboard,
): MessageInitShape<typeof GetUsageResponseSchema> {
  return {
    grouping:
      dashboard.grouping === "hour" ? UsageGrouping.HOUR : UsageGrouping.MODEL,
    asOf: timestampFromMs(dashboard.asOf),
    totals: totals(dashboard.totals),
    providers: dashboard.providers.map((provider) => ({
      key: provider.key,
      modelCount: provider.modelCount,
      totals: totals(provider),
    })),
    chart: {
      intervalMs: dashboard.chart.intervalMs,
      buckets: dashboard.chart.buckets.map(timestampFromMs),
      series: dashboard.chart.series,
    },
    breakdown: {
      rows: dashboard.breakdown.rows.map((row) => ({
        key: row.key,
        hour:
          dashboard.grouping === "hour"
            ? optionalMillis(row.timestamp)
            : undefined,
        tokenShare: row.tokenShare,
        totals: totals(row),
      })),
      page: dashboard.breakdown.page,
      pageSize: dashboard.breakdown.pageSize,
      totalRows: dashboard.breakdown.totalRows,
    },
  };
}
