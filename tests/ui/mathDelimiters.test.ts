import { describe, expect, test } from "bun:test";
import { normalizeMathDelimiters } from "../../ui/components/MarkdownMessage";

describe("math delimiters in replies", () => {
  test("rewrites LaTeX delimiters and tight single-dollar pairs as math", () => {
    expect(normalizeMathDelimiters("So $2x + 1.00 = 1.10$ holds.")).toBe(
      "So $$2x + 1.00 = 1.10$$ holds.",
    );
    expect(normalizeMathDelimiters(String.raw`Let \(x^2\) and \[y\].`)).toBe(
      "Let $$x^2$$ and $$y$$.",
    );
    expect(normalizeMathDelimiters("$$\n\\frac{a}{b}\n$$")).toBe(
      "$$\n\\frac{a}{b}\n$$",
    );
  });

  test("leaves currency and escaped dollars as text", () => {
    for (const text of [
      "The bat costs $1.05 and the ball costs $0.05.",
      "Budget $5-$10 per item.",
      "Prices: $20/$30.",
      String.raw`Pay \$5 and \$6.`,
    ]) {
      expect(normalizeMathDelimiters(text)).toBe(text);
    }
  });

  test("leaves code untouched", () => {
    const markdown = "```sh\necho $HOME$PATH\n```\n\nRun `$x$` then $y$.";
    expect(normalizeMathDelimiters(markdown)).toBe(
      "```sh\necho $HOME$PATH\n```\n\nRun `$x$` then $$y$$.",
    );
  });
});
