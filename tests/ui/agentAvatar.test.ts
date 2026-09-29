import { describe, expect, test } from "bun:test";
import {
  agentPattern,
  cellKeyframes,
  slideMoves,
} from "../../ui/components/Agents/AgentAvatar";

const ids = Array.from({ length: 200 }, (_, i) => `agent-${i}`);

describe("agentPattern", () => {
  test("is a stable, mirrored, legible 5×5 glyph", () => {
    for (const id of ids) {
      const pattern = agentPattern(id);
      expect(agentPattern(id)).toEqual(pattern);
      for (const row of pattern) expect(row).toEqual([...row].reverse());
      const filled = pattern.flat().filter(Boolean).length;
      expect(filled).toBeGreaterThanOrEqual(8);
      expect(filled).toBeLessThanOrEqual(20);
    }
  });

  test("rarely repeats across agents", () => {
    const unique = new Set(ids.map((id) => JSON.stringify(agentPattern(id))));
    expect(unique.size).toBeGreaterThan(ids.length * 0.95);
  });
});

describe("slideMoves", () => {
  test("moves filled cells into distinct empty cells, mirrored", () => {
    for (const id of ids) {
      const pattern = agentPattern(id);
      const moves = slideMoves(pattern, id);
      const targets = new Set<string>();
      for (const [key, { dx, dy }] of moves) {
        const [x = 0, y = 0] = key.split(",").map(Number);
        expect(pattern[y]?.[x]).toBe(true);
        expect(pattern[y + dy]?.[x + dx]).toBe(false);
        targets.add(`${x + dx},${y + dy}`);
        const mirror = moves.get(`${4 - x},${y}`);
        expect(mirror?.dx === -dx && mirror.dy === dy).toBe(true);
      }
      expect(targets.size).toBe(moves.size);
    }
  });
});

describe("cellKeyframes", () => {
  test("every phase starts and ends each cycle at home", () => {
    const home = "translate(0px, 0px)";
    for (const id of ids.slice(0, 20)) {
      const pattern = agentPattern(id);
      const moves = slideMoves(pattern, id);
      for (const phase of ["thinking", "tool", "responding"] as const)
        pattern.forEach((row, y) =>
          row.forEach((on, x) => {
            const frames = on && cellKeyframes(phase, x, y, moves);
            if (!frames) return;
            expect(frames[0]).toMatchObject({ offset: 0, transform: home });
            expect(frames.at(-1)).toMatchObject({ offset: 1, transform: home });
            const offsets = frames.map((f) => f.offset ?? 0);
            expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
          }),
        );
    }
  });
});
