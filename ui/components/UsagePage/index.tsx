import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { UsageDashboard } from "../../../src/usage";
import { userScopedFetch } from "../../persist/userIdentity";
import { BackToChatButton } from "../BackToChatButton";
import { RefreshButton } from "../RefreshButton";
import { SegmentedControl } from "../SegmentedControl";
import { ModelList } from "./ModelList";
import { UsageChart } from "./UsageChart";
import {
  ModelLabel,
  ProviderLabel,
  money,
  number,
  providerColor,
  seriesColor,
} from "./display";
import { type SortRule, changeSorting } from "./sorting";
import "./usage.css";

export function UsagePage({ onBack }: { onBack: () => void }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [page, setPage] = useState(0);
  const [asOf, setAsOf] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metric, setMetric] = useState<"tokens" | "spend">("tokens");
  const [grouping, setGrouping] = useState<"model" | "hour">("model");
  const [sorts, setSorts] = useState<Record<"model" | "hour", SortRule[]>>({
    model: [{ column: "spend", direction: "descending" }],
    hour: [{ column: "name", direction: "descending" }],
  });
  const sorting = sorts[grouping];
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      days: String(days),
      grouping,
      sorting: JSON.stringify(sorting),
      page: String(page),
      asOf: String(asOf),
    });
    for (const provider of selected) params.append("providers", provider);
    const request = userScopedFetch(`/api/usage?${params}`, {
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load usage. Try again.");
      return response.json() as Promise<UsageDashboard>;
    });
    request
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setAsOf(result.asOf);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Could not load usage.",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [days, grouping, sorting, page, asOf, selected]);
  const refresh = () => {
    setPage(0);
    setAsOf(Date.now());
  };
  const totals = data?.totals;
  const series =
    data?.chart.series.map((item, i) => ({
      model: item.model,
      color: seriesColor(i),
      values: metric === "tokens" ? item.tokens : item.spend,
    })) ?? [];
  const modelColors = new Map(series.map((item) => [item.model, item.color]));
  const tiles = totals
    ? (
        [
          ["Total spend", totals.cost, money],
          ["Cached input", totals.cached, number],
          ["Uncached input", totals.uncached, number],
          ["Output", totals.output, number],
          ["Cache savings, estimated", totals.savings, money],
          [
            "Cache hit rate",
            totals.cacheHitRate,
            (rate: number) => `${rate.toFixed(1)}%`,
          ],
        ] as const
      ).flatMap(([name, value, format]) =>
        // Hide metrics no provider reported rather than filling tiles with gaps.
        value === null ? [] : [{ name, value: format(value) }],
      )
    : [];
  return (
    <main className="usage-page">
      <header className="usage-header flex shrink-0 flex-wrap items-center gap-3 border-b border-border-subtle bg-background px-5 py-3">
        <BackToChatButton onClick={onBack} />
        <div className="h-4 w-px bg-border-subtle" />
        <h1 className="text-[0.9375rem] font-semibold text-foreground">
          Usage insights
        </h1>
        <div className="usage-controls">
          <select
            aria-label="Date range"
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setPage(0);
              setAsOf(Date.now());
            }}
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={0}>All time</option>
          </select>
          <RefreshButton
            label="Refresh usage"
            iconOnly
            refreshing={loading}
            onClick={refresh}
          />
        </div>
      </header>
      <div className="usage-content">
        {!data && loading ? (
          <output>Loading usage…</output>
        ) : error ? (
          <p role="alert">
            {error}{" "}
            <button type="button" onClick={refresh}>
              Retry
            </button>
          </p>
        ) : data && totals ? (
          <>
            <section className="usage-overview">
              <div>
                <div className="usage-big">
                  {metric === "tokens"
                    ? number(totals.tokens)
                    : money(totals.cost)}
                </div>
                <p className="usage-muted">
                  {metric === "tokens" ? "Processed tokens" : "Total spend"}{" "}
                  across {totals.calls.toLocaleString()} model calls
                </p>
                <ModelList>
                  {data.providers.map((item) => {
                    const provider = item.key;
                    return (
                      <button
                        type="button"
                        key={provider}
                        aria-pressed={selected.includes(provider)}
                        className={
                          selected.length > 0 && !selected.includes(provider)
                            ? "usage-dim"
                            : ""
                        }
                        onClick={(event) => {
                          const additive = event.shiftKey;
                          setSelected((current) => {
                            if (!additive) {
                              return current.length === 1 &&
                                current[0] === provider
                                ? []
                                : [provider];
                            }
                            return current.includes(provider)
                              ? current.filter((value) => value !== provider)
                              : [...current, provider];
                          });
                          setPage(0);
                        }}
                      >
                        <span
                          className="usage-dot"
                          style={{ background: providerColor(provider) }}
                        />
                        <span>
                          <ProviderLabel provider={provider} />
                          <small>
                            {item.modelCount}{" "}
                            {item.modelCount === 1 ? "model" : "models"} ·{" "}
                            {item.calls} calls · {money(item.cost)}
                          </small>
                        </span>
                        <strong>
                          {metric === "tokens"
                            ? number(item.tokens)
                            : money(item.cost)}
                        </strong>
                      </button>
                    );
                  })}
                </ModelList>
              </div>
              <div className="usage-chart">
                <div className="usage-section-title">
                  <h2>
                    {days === 0
                      ? metric === "tokens"
                        ? "Processed tokens over time"
                        : "Spend over time"
                      : `${days === 1 ? "Hourly" : "Daily"} ${metric === "tokens" ? "processed tokens" : "spend"}`}
                  </h2>
                  <SegmentedControl
                    label="Chart metric"
                    value={metric}
                    onChange={setMetric}
                    options={[
                      { value: "tokens", label: "Tokens" },
                      { value: "spend", label: "Spend" },
                    ]}
                  />
                </div>
                {totals.calls ? (
                  <UsageChart
                    series={series}
                    buckets={data.chart.buckets}
                    metric={metric}
                    intervalMs={data.chart.intervalMs}
                  />
                ) : (
                  <div className="usage-empty">
                    <h2>No usage recorded yet</h2>
                    <p>Run a chat to start tracking tokens and spend.</p>
                  </div>
                )}
              </div>
            </section>
            {tiles.length > 0 && (
              <section className="usage-totals" aria-label="Totals">
                {tiles.map(({ name, value }) => (
                  <div key={name}>
                    <p>{name}</p>
                    <strong>{value}</strong>
                  </div>
                ))}
              </section>
            )}
            <section>
              <div className="usage-section-title">
                <h2>Breakdown</h2>
                <SegmentedControl
                  label="Breakdown grouping"
                  value={grouping}
                  onChange={(value) => {
                    setGrouping(value);
                    setPage(0);
                  }}
                  options={[
                    { value: "model", label: "Model" },
                    { value: "hour", label: "Hour" },
                  ]}
                />
              </div>
              <div className="usage-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {(
                        [
                          [
                            "name",
                            data.grouping === "model" ? "Model" : "Hour",
                          ],
                          ["spend", "Spend"],
                          ["share", "Share of total tokens"],
                          ["tokens", "Tokens"],
                          ["cached", "Cached input"],
                          ["savings", "Cache savings"],
                        ] as const
                      ).map(([column, label]) => {
                        const priority = sorting.findIndex(
                          (rule) => rule.column === column,
                        );
                        const rule = sorting[priority];
                        return (
                          <th
                            key={column}
                            aria-sort={
                              priority === 0 ? rule?.direction : "none"
                            }
                            data-sort-priority={rule ? priority + 1 : undefined}
                          >
                            <button
                              type="button"
                              onClick={(event) => {
                                setPage(0);
                                setSorts((current) => ({
                                  ...current,
                                  [grouping]: changeSorting(
                                    current[grouping],
                                    column,
                                    event.shiftKey,
                                  ),
                                }));
                              }}
                              title={
                                column === "share"
                                  ? "This row’s tokens as a percentage of all tokens in the selected date range and provider filter."
                                  : undefined
                              }
                              aria-label={
                                rule && sorting.length > 1
                                  ? `${label}, sort priority ${priority + 1}, ${rule.direction}`
                                  : label
                              }
                            >
                              <span className="usage-sort-label">{label}</span>
                              <span
                                aria-hidden="true"
                                className="usage-sort-indicator"
                                data-active={Boolean(rule)}
                              >
                                <ArrowUp
                                  size={13}
                                  className="usage-sort-arrow"
                                  style={{
                                    transform:
                                      rule?.direction === "descending"
                                        ? "rotate(180deg)"
                                        : "rotate(0deg)",
                                  }}
                                />
                                <sup>
                                  {rule && sorting.length > 1
                                    ? priority + 1
                                    : ""}
                                </sup>
                              </span>
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {data.breakdown.rows.map((item) => {
                      const { key, tokens } = item;
                      return (
                        <tr key={key}>
                          <td>
                            {data.grouping === "model" ? (
                              <ModelLabel model={key} />
                            ) : (
                              new Date(item.timestamp).toLocaleString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                },
                              )
                            )}
                          </td>
                          <td>{money(item.cost)}</td>
                          <td>
                            <span className="usage-share">
                              <span
                                style={{
                                  width: `${item.tokenShare}%`,
                                  background:
                                    data.grouping === "model"
                                      ? modelColors.get(key)
                                      : "#999",
                                }}
                              />
                            </span>
                            {item.tokenShare.toFixed(1)}%
                          </td>
                          <td>{number(tokens)}</td>
                          <td>{number(item.cached)}</td>
                          <td>{money(item.savings)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {data.breakdown.totalRows > data.breakdown.pageSize && (
                <nav className="usage-pagination" aria-label="Breakdown pages">
                  <span>
                    {data.breakdown.page * data.breakdown.pageSize + 1}–
                    {Math.min(
                      (data.breakdown.page + 1) * data.breakdown.pageSize,
                      data.breakdown.totalRows,
                    )}{" "}
                    of {data.breakdown.totalRows}
                  </span>
                  <button
                    type="button"
                    disabled={loading || data.breakdown.page === 0}
                    onClick={() => setPage(data.breakdown.page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={
                      loading ||
                      (data.breakdown.page + 1) * data.breakdown.pageSize >=
                        data.breakdown.totalRows
                    }
                    onClick={() => setPage(data.breakdown.page + 1)}
                  >
                    Next
                  </button>
                </nav>
              )}
            </section>
            <p className="usage-footnote">
              Usage is tracked from when this feature is enabled, including
              subagent calls. Totals include reported values only; missing
              metrics are not treated as zero, and metrics no call reported are
              hidden. Spend is provider-reported USD. Cache savings estimate
              read discounts using catalog rates at the time of the call,
              excluding cache write fees. Local model calls and tokens are
              included with $0 API spend.
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
