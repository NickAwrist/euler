import {
  type PointerEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { color, money, number } from "./display";

type Series = { model: string; values: number[] };
export function UsageChart({
  series,
  buckets,
  metric,
  intervalMs,
  asOf,
}: {
  series: Series[];
  buckets: number[];
  metric: "tokens" | "spend";
  intervalMs: number;
  asOf: number;
}) {
  const hourly = intervalMs === 3600000;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLInputElement>(null);
  const anchor = useRef({ x: 0, y: 0 });
  const tooltipId = useId();
  const [active, setActive] = useState<number | null>(null);
  const count = buckets.length;
  const index = active === null ? null : Math.min(active, count - 1);
  const max = Math.max(0, ...series.flatMap((item) => item.values)) || 1;
  const x = (i: number) => 64 + (i / (count - 1)) * 686;
  const y = (value: number) => 235 - (value / max) * 210;
  const format = metric === "tokens" ? number : money;
  const label = (time: number) =>
    new Date(time).toLocaleString(
      undefined,
      hourly ? { hour: "numeric" } : { month: "short", day: "numeric" },
    );
  function placeTooltip() {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    const { x, y } = anchor.current;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = Math.max(
      8,
      Math.min(
        x + 14 + width > window.innerWidth ? x - width - 14 : x + 14,
        window.innerWidth - width - 8,
      ),
    );
    const top = Math.max(
      8,
      Math.min(
        y + 14 + height > window.innerHeight ? y - height - 14 : y + 14,
        window.innerHeight - height - 8,
      ),
    );
    tooltip.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }
  useLayoutEffect(() => {
    if (active !== null) placeTooltip();
  });
  function keyboardPoint(value: number) {
    const bounds = cursorRef.current?.getBoundingClientRect();
    if (bounds)
      anchor.current = {
        x: bounds.left + (value / (count - 1)) * bounds.width,
        y: bounds.top + bounds.height / 2,
      };
    setActive(value);
    placeTooltip();
  }
  function point(event: PointerEvent<HTMLInputElement>) {
    anchor.current = { x: event.clientX, y: event.clientY };
    placeTooltip();
    const bounds = event.currentTarget.getBoundingClientRect();
    setActive(
      Math.max(
        0,
        Math.min(
          count - 1,
          Math.round(
            ((event.clientX - bounds.left) / bounds.width) * (count - 1),
          ),
        ),
      ),
    );
  }
  return (
    <div className="usage-plot">
      <svg
        viewBox="0 0 760 280"
        role="img"
        aria-label={`${metric === "tokens" ? "Tokens" : "Spend"} by model over time`}
      >
        <title>Usage by model</title>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1="64"
              x2="750"
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="var(--color-border-subtle)"
            />
            <text
              x="54"
              y={y(max * f) + 4}
              textAnchor="end"
              fill="var(--color-muted-foreground)"
              fontSize="12"
            >
              {format(max * f)}
            </text>
          </g>
        ))}
        {series.map(({ model, values }, i) => {
          const points = values
            .map((value, j) => `${x(j)},${y(value)}`)
            .join(" ");
          return (
            <g key={model}>
              <polygon
                points={`64,235 ${points} 750,235`}
                fill={color(model)}
                opacity=".06"
              />
              <polyline
                points={points}
                fill="none"
                stroke={color(model)}
                strokeWidth="2.5"
                strokeDasharray={
                  series
                    .slice(0, i)
                    .some((item) => color(item.model) === color(model))
                    ? "6 4"
                    : undefined
                }
              />
              {index !== null && (
                <circle
                  cx={x(index)}
                  cy={y(values[index] ?? 0)}
                  r="2.5"
                  fill={color(model)}
                  stroke="var(--color-background)"
                  strokeWidth="1"
                />
              )}
            </g>
          );
        })}
        {index !== null && (
          <line
            x1={x(index)}
            x2={x(index)}
            y1="25"
            y2="235"
            stroke="var(--color-muted-foreground)"
            strokeDasharray="2 4"
            strokeOpacity=".35"
            strokeWidth=".75"
          />
        )}
        {[0, Math.floor((count - 1) / 2), count - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y="268"
            textAnchor={i === 0 ? "start" : i === count - 1 ? "end" : "middle"}
            fill="var(--color-muted-foreground)"
            fontSize="12"
          >
            {label(buckets[i]!)}
          </text>
        ))}
      </svg>
      <input
        ref={cursorRef}
        className="usage-chart-cursor"
        aria-describedby={index === null ? undefined : tooltipId}
        type="range"
        aria-label="Inspect usage at a date"
        aria-valuetext={
          index === null
            ? undefined
            : new Date(buckets[index]!).toLocaleString()
        }
        min={0}
        max={count - 1}
        value={index ?? 0}
        onPointerMove={point}
        onPointerDown={point}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setActive(null);
        }}
        onFocus={() => {
          if (active === null) keyboardPoint(0);
        }}
        onBlur={() => setActive(null)}
        onChange={(event) => setActive(Number(event.target.value))}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowRight" || event.key === "ArrowUp"
              ? Math.min(count - 1, (index ?? 0) + 1)
              : event.key === "ArrowLeft" || event.key === "ArrowDown"
                ? Math.max(0, (index ?? 0) - 1)
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? count - 1
                    : null;
          if (next !== null) {
            event.preventDefault();
            keyboardPoint(next);
          }
        }}
      />
      {index !== null &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className="usage-tooltip"
          >
            <header>
              <strong>
                {new Date(buckets[index]!).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  ...(hourly ? ({ hour: "numeric" } as const) : {}),
                  timeZoneName: "short",
                })}
              </strong>
              <span className="usage-tooltip-metric">
                {metric === "tokens" ? "Processed tokens" : "Spend"}
              </span>
            </header>
            {series.map((item) => (
              <div key={item.model}>
                <span
                  className="usage-dot"
                  style={{ background: color(item.model) }}
                />
                <span className="usage-tooltip-name">
                  {item.model.replace(/^openrouter:/, "")}
                </span>
                <b>
                  {metric === "tokens"
                    ? (item.values[index] ?? 0).toLocaleString()
                    : money(item.values[index] ?? 0)}
                </b>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
