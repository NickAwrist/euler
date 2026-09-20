import { expect, test } from "bun:test";
import {
  type SortRule,
  changeSorting,
} from "../../ui/components/UsagePage/sorting";

test("Shift-click appends priorities and toggles in place; plain click replaces them", () => {
  const primary: SortRule[] = [{ column: "spend", direction: "descending" }];
  const secondary = changeSorting(primary, "tokens", true);
  const tertiary = changeSorting(secondary, "name", true);
  expect(tertiary.map((rule) => rule.column)).toEqual([
    "spend",
    "tokens",
    "name",
  ]);
  expect(changeSorting(tertiary, "tokens", true)).toEqual([
    primary[0]!,
    { column: "tokens", direction: "ascending" },
    tertiary[2]!,
  ]);
  expect(changeSorting(tertiary, "tokens", false)).toEqual([
    { column: "tokens", direction: "ascending" },
  ]);
});
