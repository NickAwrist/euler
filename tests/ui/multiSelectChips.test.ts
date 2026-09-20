import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MultiSelectChips } from "../../ui/components/MultiSelectChips";

describe("MultiSelectChips", () => {
  test("renders chips with aria-pressed state matching selection", () => {
    const items = [
      { id: "tool-1", name: "Search" },
      { id: "tool-2", name: "Terminal" },
    ];
    const html = renderToStaticMarkup(
      React.createElement(MultiSelectChips<{ id: string; name: string }>, {
        label: "Tools",
        items,
        selected: ["tool-1"],
        getId: (item) => item.id,
        getLabel: (item) => item.name,
        onToggle: () => {},
      }),
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Search");
    expect(html).toContain("Terminal");
  });
});
