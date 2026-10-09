import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Agent } from "../../../src/schemas/agents";
import type { AgentPhase } from "../../types";
import { useAgents } from "./AgentContext";

const GRID = 5;
const HALF = Math.ceil(GRID / 2);
const CENTER = (GRID - 1) / 2;
const GAP = 0.6;
const CELL = (20 - (GRID - 1) * GAP) / GRID;
const PITCH = CELL + GAP;
const CYCLE_MS = 2400;
// Equal OKLCH lightness and chroma so no hue looks heavier than another.
const COLORS = [255, 350, 22, 155, 75, 295, 210].map(
  (hue) => `oklch(0.74 0.13 ${hue})`,
);

export type AgentPattern = boolean[][];
type Move = { dx: number; dy: number; order: number };

function seededRandom(value: string) {
  let seed = 2166136261;
  for (let i = 0; i < value.length; i++)
    seed = Math.imul(seed ^ value.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A mirrored 5×5 pattern, dense enough to read as one glyph at small sizes. */
export function agentPattern(agentId: string): AgentPattern {
  const random = seededRandom(agentId);
  for (;;) {
    const rows = Array.from({ length: GRID }, () =>
      Array.from({ length: HALF }, () => random() < 0.55),
    );
    const filled = rows.flat().filter(Boolean).length / (GRID * HALF);
    if (
      filled >= 0.45 &&
      filled <= 0.75 &&
      rows[0]?.some(Boolean) &&
      rows[GRID - 1]?.some(Boolean) &&
      rows.some((row) => row[0])
    )
      return rows.map((row) => [
        ...row,
        ...row.slice(0, GRID - HALF).reverse(),
      ]);
  }
}

/** Up to three mirrored pairs that slide into an empty neighbour while thinking. */
export function slideMoves(pattern: AgentPattern, agentId: string) {
  const random = seededRandom(`${agentId}:slide`);
  const moves = new Map<string, Move>();
  const taken = new Set<string>();
  let order = 0;
  const candidates = pattern
    .flatMap((row, y) => row.slice(0, HALF).map((on, x) => ({ on, x, y })))
    .filter((cell) => cell.on)
    .sort(() => random() - 0.5);
  for (const { x, y } of candidates) {
    if (order === 3) break;
    const directions = [
      [0, -1],
      [0, 1],
      ...(x < CENTER
        ? [
            [-1, 0],
            [1, 0],
          ]
        : []),
    ].sort(() => random() - 0.5);
    for (const [dx = 0, dy = 0] of directions) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx === CENTER && x !== CENTER) continue;
      if (pattern[ty]?.[tx] !== false || taken.has(`${tx},${ty}`)) continue;
      moves.set(`${x},${y}`, { dx, dy, order });
      if (x !== CENTER)
        moves.set(`${GRID - 1 - x},${y}`, { dx: -dx, dy, order });
      taken.add(`${tx},${ty}`).add(`${GRID - 1 - tx},${ty}`);
      order++;
      break;
    }
  }
  return moves;
}

const EASE = "cubic-bezier(.6,0,.2,1)";
/** Keyframes from [offset, dx, dy, easing] stops, always starting and ending home. */
function path(stops: Array<[number, number, number, string?]>): Keyframe[] {
  return [[0, 0, 0] as const, ...stops, [1, 0, 0] as const].map(
    ([offset, dx, dy, easing]) => ({
      offset,
      transform: `translate(${dx}px, ${dy}px)`,
      ...(easing ? { easing } : {}),
    }),
  );
}

/** One cell's keyframes for a full cycle of a phase, or null if it stays put. */
export function cellKeyframes(
  phase: AgentPhase,
  x: number,
  y: number,
  moves: Map<string, Move>,
): Keyframe[] | null {
  if (phase === "thinking") {
    const move = moves.get(`${x},${y}`);
    if (!move) return null;
    const start = move.order * 0.3;
    const dx = move.dx * PITCH;
    const dy = move.dy * PITCH;
    return path([
      [start, 0, 0, EASE],
      [start + 0.1, dx, dy],
      [start + 0.22, dx, dy, EASE],
      [start + 0.32, 0, 0],
    ]);
  }
  if (phase === "tool") {
    const start = y * 0.05;
    const dx = (y % 2 ? 1 : -1) * PITCH;
    return path([
      [start, 0, 0, EASE],
      [start + 0.12, dx, 0],
      [start + 0.3, dx, 0, EASE],
      [start + 0.45, 0, 0],
    ]);
  }
  const start = Math.abs(x - CENTER) * 0.05;
  const up = "cubic-bezier(.3,0,.5,1)";
  const down = "cubic-bezier(.5,0,.7,1)";
  return path([
    [start, 0, 0, up],
    [start + 0.1, 0, -2.6, down],
    [start + 0.2, 0, 0],
    [start + 0.5, 0, 0, up],
    [start + 0.6, 0, -2.6, down],
    [start + 0.7, 0, 0],
  ]);
}

/**
 * Plays whole cycles of the latest phase so a phase change never cuts a move
 * short, and settles home after the phase ends.
 */
function usePhaseMotion(
  svg: RefObject<SVGSVGElement | null>,
  agentId: string,
  pattern: AgentPattern,
  phase: AgentPhase | null,
) {
  const latest = useRef(phase);
  useLayoutEffect(() => {
    latest.current = phase;
  });
  const [looping, setLooping] = useState(false);
  useEffect(() => {
    if (phase) setLooping(true);
  }, [phase]);
  useEffect(() => {
    const root = svg.current;
    if (
      !looping ||
      !root ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const moves = slideMoves(pattern, agentId);
    let animations: Animation[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const cycle = () => {
      const current = latest.current;
      if (stopped) return;
      if (!current) {
        setLooping(false);
        return;
      }
      animations = [...root.querySelectorAll<SVGRectElement>("rect")].flatMap(
        (rect) => {
          const frames = cellKeyframes(
            current,
            Number(rect.dataset.x),
            Number(rect.dataset.y),
            moves,
          );
          return frames ? [rect.animate(frames, CYCLE_MS)] : [];
        },
      );
      timer = setTimeout(cycle, CYCLE_MS);
    };
    cycle();
    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const animation of animations) animation.cancel();
    };
  }, [svg, looping, pattern, agentId]);
}

export function AgentAvatar({
  agent,
  size = 18,
}: {
  agent: Agent;
  size?: number;
}) {
  const { agents, phases } = useAgents();
  const pattern = useMemo(() => agentPattern(agent.id), [agent.id]);
  const svg = useRef<SVGSVGElement>(null);
  usePhaseMotion(
    svg,
    agent.id,
    pattern,
    agent.status === "running" ? (phases[agent.id] ?? "thinking") : null,
  );
  // Colors follow spawn order so the first agents in a session never share one.
  const order = agents
    .filter((a) => a.kind !== "main")
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .findIndex((a) => a.id === agent.id);
  return (
    <svg
      ref={svg}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="shrink-0 overflow-visible"
      fill={COLORS[Math.max(0, order) % COLORS.length]}
    >
      {pattern.flatMap((row, y) =>
        row.map(
          (on, x) =>
            on && (
              <rect
                // biome-ignore lint/suspicious/noArrayIndexKey: cells are fixed grid positions
                key={`${x},${y}`}
                data-x={x}
                data-y={y}
                x={2 + x * PITCH}
                y={2 + y * PITCH}
                width={CELL}
                height={CELL}
                rx={0.9}
              />
            ),
        ),
      )}
    </svg>
  );
}
