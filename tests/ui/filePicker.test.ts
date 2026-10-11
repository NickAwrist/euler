import { describe, expect, test } from "bun:test";
import {
  completeFileToken,
  findActiveFileToken,
} from "../../ui/components/filePicker";

describe("file picker", () => {
  test("finds paths at the caret and replaces the rest of the token", () => {
    expect(findActiveFileToken("Check @src/index.ts next", 10)).toEqual({
      start: 6,
      end: 19,
      query: "src",
    });
    expect(findActiveFileToken("@", 1)).toEqual({
      start: 0,
      end: 1,
      query: "",
    });
    expect(
      completeFileToken(
        "Check @src/index.ts next",
        { start: 6, end: 19, query: "src" },
        "src/server.ts",
      ),
    ).toEqual({ value: "Check @src/server.ts next", caret: 20 });
  });

  test("ignores emails, closed references, and invalid caret positions", () => {
    for (const value of [
      "nick@example.com",
      "@src/index.ts next",
      '@"notes one.md" ',
    ]) {
      expect(findActiveFileToken(value, value.length)).toBeNull();
    }
    expect(findActiveFileToken("@src", 0)).toBeNull();
    expect(findActiveFileToken("@src", -1)).toBeNull();
    expect(findActiveFileToken("@src", 5)).toBeNull();
  });

  test("quotes paths with spaces and completes a quoted query", () => {
    expect(
      completeFileToken(
        "Read @notes",
        { start: 5, end: 11, query: "notes" },
        "docs/notes one.md",
      ),
    ).toEqual({ value: 'Read @"docs/notes one.md" ', caret: 26 });
    const value = 'Read @"docs/notes one.md" next';
    const token = findActiveFileToken(value, 16);
    expect(token).toEqual({ start: 5, end: 25, query: "docs/note" });
    expect(completeFileToken(value, token!, "docs/notes two.md").value).toBe(
      'Read @"docs/notes two.md" next',
    );
  });
});
