import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnchoredPopover } from "../../ui/components/AnchoredPopover";

describe("AnchoredPopover abstraction component", () => {
  test("renders trigger with accessible attributes and popover wiring", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AnchoredPopover,
        {
          id: "test-popover",
          ariaLabel: "Test options",
          containerClassName: "custom-container",
          panelClassName: "custom-panel",
          renderTrigger: ({ ref, popoverTarget, isOpen }) =>
            React.createElement(
              "button",
              {
                ref,
                id: "test-trigger",
                type: "button",
                popoverTarget,
                "aria-expanded": isOpen,
                "aria-controls": popoverTarget,
              },
              "Open",
            ),
        },
        React.createElement("div", null, "Panel content"),
      ),
    );

    expect(html).toContain('class="relative shrink-0 custom-container"');
    expect(html).toContain('popoverTarget="test-popover"');
    expect(html).toContain('aria-controls="test-popover"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("<dialog");
    expect(html).toContain('id="test-popover"');
    expect(html).toContain('popover="auto"');
    expect(html).toContain('aria-label="Test options"');
    expect(html).toContain("anchored-popover");
    expect(html).toContain("custom-panel");
    expect(html).toContain("Panel content");
  });

  test("generates unique ID and wires popoverTarget when id is omitted", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AnchoredPopover,
        {
          ariaLabel: "Auto ID popover",
          renderTrigger: ({ popoverTarget }) =>
            React.createElement(
              "button",
              { type: "button", popoverTarget },
              "Trigger",
            ),
        },
        React.createElement("div", null, "Direct content"),
      ),
    );

    expect(html).toContain('popoverTarget="');
    expect(html).toContain("<dialog");
    expect(html).toContain('popover="auto"');
    expect(html).toContain('aria-label="Auto ID popover"');
    expect(html).toContain("Direct content");
  });
});
