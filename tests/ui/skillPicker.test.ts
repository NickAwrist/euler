import { describe, expect, test } from "bun:test";
import {
  completeSkillToken,
  findActiveSkillToken,
} from "../../ui/components/skillPicker";

describe("skill picker", () => {
  test("finds a skill token at the caret", () => {
    expect(findActiveSkillToken("Use $release", 12)).toEqual({
      start: 4,
      end: 12,
      query: "release",
    });
    expect(findActiveSkillToken("$", 1)).toEqual({
      start: 0,
      end: 1,
      query: "",
    });
  });

  test("ignores dollar signs inside words and closed tokens", () => {
    expect(findActiveSkillToken("price$release", 13)).toBeNull();
    expect(findActiveSkillToken("Use $release now", 16)).toBeNull();
  });

  test("replaces the full token and places the caret after it", () => {
    expect(
      completeSkillToken(
        "Use $rel",
        { start: 4, end: 8, query: "rel" },
        "release-notes",
      ),
    ).toEqual({ value: "Use $release-notes ", caret: 19 });

    expect(
      completeSkillToken(
        "$rel next",
        { start: 0, end: 4, query: "rel" },
        "release-notes",
      ),
    ).toEqual({ value: "$release-notes next", caret: 14 });
  });
});
