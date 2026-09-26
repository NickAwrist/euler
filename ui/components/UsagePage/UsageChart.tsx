import {
  type PointerEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { color, money, number, provider } from "./display";

type Series = { model: string; values: number[] };
type Shape = "circle" | "square" | "triangle" | "diamond";
// Models share their provider's brand color. Line style, marker and bar
// hatching distinguish models from the same provider, in token order.
const variants: {
  dash?: string;
  marker: Shape;
  hatch?: { angle: number; cross?: boolean };
}[] = [
  { marker: "circle" },
  { dash: "6 5", marker: "square", hatch: { angle: 45 } },
  { dash: "0 5", marker: "triangle", hatch: { angle: 135 } },
  { dash: "8 5 0 5", marker: "diamond", hatch: { angle: 45, cross: true } },
];

function Marker({
  shape,
  x,
  y,
  size,
  fill,
}: { shape: Shape; x: number; y: number; size: number; fill: string }) {
  const style = { fill, stroke: "var(--color-background)", strokeWidth: 1 };
  if (shape === "circle") return <circle cx={x} cy={y} r={size} {...style} />;
  if (shape === "square")
    return (
      <rect
        x={x - size}
        y={y - size}
        width={size * 2}
        height={size * 2}
        {...style}
      />
    );
  const corners =
    shape === "triangle"
      ? [
          [0, -1.25],
          [1.15, 0.85],
          [-1.15, 0.85],
        ]
      : [
          [0, -1.35],
          [1.35, 0],
          [0, 1.35],
          [-1.35, 0],
        ];
  return (
    <polygon
      points={corners
        .map(([cx = 0, cy = 0]) => `${x + cx * size},${y + cy * size}`)
        .join(" ")}
      {...style}
    />
  );
}
export function UsageChart({
  series,
  buckets,
  metric,
  intervalMs,
}: {
  series: Series[];
  buckets: number[];
  metric: "tokens" | "spend";
  intervalMs: number;
}) {
  const hourly = intervalMs === 3600000;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLInputElement>(null);
  const anchor = useRef({ x: 0, y: 0 });
  const tooltipId = useId();
  const patternId = useId().replace(/[^\w-]/g, "");
  const [active, setActive] = useState<number | null>(null);
  const providerCounts = new Map<string, number>();
  const styled = series.map((item, i) => {
    const key = provider(item.model);
    const rank = providerCounts.get(key) ?? 0;
    providerCounts.set(key, rank + 1);
    const variant = variants[Math.min(rank, variants.length - 1)]!;
    return {
      ...item,
      ...variant,
      color: color(item.model),
      fill: variant.hatch ? `url(#${patternId}-${i})` : color(item.model),
    };
  });
  const count = buckets.length;
  const index = active === null ? null : Math.min(active, count - 1);
  const stacks = buckets.map((_, i) =>
    series.reduce((sum, item) => sum + (item.values[i] ?? 0), 0),
  );
  // Lines imply continuity, so few or mostly empty buckets render as bars.
  const used = stacks.filter(Boolean).length;
  const bars = used < 4 || used * 2 < count;
  const max =
    Math.max(0, ...(bars ? stacks : series.flatMap((item) => item.values))) ||
    1;
  const slot = 686 / (bars ? count : count - 1);
  const x = (i: number) => 64 + (bars ? i + 0.5 : i) * slot;
  const barWidth = Math.min(slot * 0.6, 48);
  // Markers on every point turn dense ranges into clutter; hover still shows them.
  const pointMarkers = slot >= 16;
  const bucketAt = (fraction: number) =>
    Math.max(
      0,
      Math.min(
        count - 1,
        bars
          ? Math.floor(fraction * count)
          : Math.round(fraction * (count - 1)),
      ),
    );
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
        x: bounds.left + ((x(value) - 64) / 686) * bounds.width,
        y: bounds.top + bounds.height / 2,
      };
    setActive(value);
    placeTooltip();
  }
  function point(event: PointerEvent<HTMLInputElement>) {
    anchor.current = { x: event.clientX, y: event.clientY };
    placeTooltip();
    const bounds = event.currentTarget.getBoundingClientRect();
    setActive(bucketAt((event.clientX - bounds.left) / bounds.width));
  }
  return (
    <>
      <div className="usage-plot">
        <svg
          viewBox="0 0 760 280"
          role="img"
          aria-label={`${metric === "tokens" ? "Tokens" : "Spend"} by model over time`}
        >
          <title>Usage by model</title>
          <defs>
            {styled.map(
              (item, i) =>
                item.hatch && (
                  <pattern
                    key={item.model}
                    id={`${patternId}-${i}`}
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                    patternTransform={`rotate(${item.hatch.angle})`}
                  >
                    <rect width="6" height="6" fill={item.color} />
                    <line
                      x1="0"
                      x2="0"
                      y2="6"
                      stroke="var(--color-background)"
                      strokeWidth="2.5"
                    />
                    {item.hatch.cross && (
                      <line
                        x2="6"
                        y1="0"
                        y2="0"
                        stroke="var(--color-background)"
                        strokeWidth="2.5"
                      />
                    )}
                  </pattern>
                ),
            )}
          </defs>
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
          {bars
            ? buckets.map((bucket, i) => {
                let base = 0;
                return (
                  <g key={bucket}>
                    {styled.map(({ model, fill, values }) => {
                      const value = values[i] ?? 0;
                      if (!value) return null;
                      base += value;
                      return (
                        <rect
                          key={model}
                          x={x(i) - barWidth / 2}
                          y={y(base)}
                          width={barWidth}
                          height={y(base - value) - y(base)}
                          fill={fill}
                          stroke="var(--color-background)"
                          strokeWidth="1"
                        />
                      );
                    })}
                  </g>
                );
              })
            : styled.map(({ model, color, dash, marker, values }) => {
                const points = values
                  .map((value, j) => `${x(j)},${y(value)}`)
                  .join(" ");
                return (
                  <g key={model}>
                    <polygon
                      points={`64,235 ${points} 750,235`}
                      fill={color}
                      opacity=".06"
                    />
                    <polyline
                      points={points}
                      fill="none"
                      stroke={color}
                      strokeWidth="2.5"
                      strokeDasharray={dash}
                      strokeLinecap="round"
                    />
                    {values.map(
                      (value, j) =>
                        (j === index || (pointMarkers && value > 0)) && (
                          <Marker
                            key={buckets[j]}
                            shape={marker}
                            x={x(j)}
                            y={y(value)}
                            size={j === index ? 5 : 4}
                            fill={color}
                          />
                        ),
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
          {[...new Set([0, Math.floor((count - 1) / 2), count - 1])].map(
            (i) => (
              <text
                key={i}
                x={x(i)}
                y="268"
                textAnchor={
                  bars
                    ? "middle"
                    : i === 0
                      ? "start"
                      : i === count - 1
                        ? "end"
                        : "middle"
                }
                fill="var(--color-muted-foreground)"
                fontSize="12"
              >
                {label(buckets[i]!)}
              </text>
            ),
          )}
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
              {styled.map((item) => (
                <div key={item.model}>
                  <Swatch item={item} bars={bars} />
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
      {series.length > 1 && (
        <ul className="usage-chart-legend" aria-label="Models">
          {styled.map((item) => (
            <li key={item.model}>
              <Swatch item={item} bars={bars} />
              {item.model.replace(/^openrouter:/, "")}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// A legend sample of the series mark: its hatched bar fill or its line and marker.
function Swatch({
  item,
  bars,
}: {
  item: { color: string; fill: string; dash?: string; marker: Shape };
  bars: boolean;
}) {
  return (
    <svg
      className="usage-swatch"
      width="22"
      height="12"
      viewBox="0 0 22 12"
      aria-hidden="true"
    >
      {bars ? (
        <rect y="1" width="22" height="10" rx="2" fill={item.fill} />
      ) : (
        <>
          <line
            x1="2"
            x2="20"
            y1="6"
            y2="6"
            stroke={item.color}
            strokeWidth="2"
            strokeDasharray={item.dash}
            strokeLinecap="round"
          />
          <Marker
            shape={item.marker}
            x={11}
            y={6}
            size={3.5}
            fill={item.color}
          />
        </>
      )}
    </svg>
  );
}
