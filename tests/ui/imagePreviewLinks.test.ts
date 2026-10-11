import { describe, expect, test } from "bun:test";
import { extractImagePreviewLinks } from "../../ui/components/MarkdownMessage";

describe("image preview links", () => {
  test("collects bare, labeled and reference HTTP links in order, once", () => {
    expect(
      extractImagePreviewLinks(
        [
          "Image 1: https://example.com/one.png?signature=abc.",
          "[Second](https://example.com/render?id=2)",
          "<https://example.com/one.png?signature=abc>",
          "[Third][image]",
          "[image]: https://example.com/three.webp",
        ].join("\n\n"),
      ),
    ).toEqual([
      "https://example.com/one.png?signature=abc",
      "https://example.com/render?id=2",
      "https://example.com/three.webp",
    ]);
  });

  test("ignores code, unused definitions, non-HTTP links and embedded images", () => {
    expect(
      extractImagePreviewLinks(
        [
          "`https://example.com/inline.png`",
          "```\nhttps://example.com/fenced.png\n```",
          "    https://example.com/indented.png",
          "[File](/tmp/image.png) [Mail](mailto:a@example.com) [Jump](#image)",
          "![Embedded][image] [Already shown][image]",
          "[image]: https://example.com/embedded.png",
          "[unused]: https://example.com/unused.png",
        ].join("\n\n"),
      ),
    ).toEqual([]);
  });
});
