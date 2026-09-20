import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Modal } from "../../ui/components/Modal";
import { modalShell, modalSurface } from "../../ui/styles";

describe("Modal primitive component", () => {
  test("renders closed dialog by default with hidden-when-closed class and title wiring", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Modal,
        {
          onClose: () => {},
          title: "Settings Modal",
          eyebrow: "Preferences",
        },
        React.createElement("p", null, "Modal body content"),
      ),
    );

    // Closed by default (no open attribute in static markup)
    expect(html).toContain("<dialog");
    expect(html).not.toContain("<dialog open");
    expect(html).not.toContain('<dialog class="" open');

    // Contains [&:not([open])]:hidden in modalShell
    expect(modalShell).toContain("[&:not([open])]:hidden");
    expect(html).toContain("[&amp;:not([open])]:hidden");

    // Accessibility wiring
    expect(html).toContain('aria-labelledby="');
    expect(html).toContain("Settings Modal</h2>");
    expect(html).toContain("Preferences</div>");
    expect(html).toContain("Modal body content</p>");
  });

  test("renders custom aria-label when title is omitted", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Modal,
        {
          onClose: () => {},
          ariaLabel: "Custom Dialog Label",
          hideCloseButton: true,
        },
        React.createElement("div", null, "Headless Content"),
      ),
    );

    expect(html).toContain('aria-label="Custom Dialog Label"');
    expect(html).not.toContain("aria-labelledby");
    expect(html).toContain("Headless Content</div>");
  });
});
