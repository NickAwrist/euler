import type { SortColumn, SortRule } from "../../../src/usage";
export type { SortColumn, SortRule } from "../../../src/usage";

export function changeSorting(
  rules: SortRule[],
  column: SortColumn,
  additive: boolean,
): SortRule[] {
  const existing = rules.find((rule) => rule.column === column);
  const rule: SortRule = {
    column,
    direction: existing
      ? existing.direction === "ascending"
        ? "descending"
        : "ascending"
      : column === "name"
        ? "ascending"
        : "descending",
  };
  if (!additive) return [rule];
  return existing
    ? rules.map((item) => (item.column === column ? rule : item))
    : [...rules, rule];
}
