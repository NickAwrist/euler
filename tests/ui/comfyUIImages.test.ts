import { describe, expect, test } from "bun:test";
import {
  comfyUIImageKey,
  extractComfyUIImageUrls,
} from "../../ui/components/MarkdownMessage";

describe("ComfyUI images in replies", () => {
  test("extracts only URLs rendered as images", () => {
    const markdown = [
      "```",
      "/api/comfyui/view/fenced.png?type=output",
      "```",
      "Inline `![code](/api/comfyui/view/inline.png)` stays text.",
      "Saved to /api/comfyui/view/bare.png?type=output.",
    ].join("\n");
    expect(extractComfyUIImageUrls(markdown)).toEqual([
      "/api/comfyui/view/bare.png?type=output",
    ]);
  });

  test("does not mistake indented or multiline inline code for images", () => {
    expect(
      extractComfyUIImageUrls("    ![code](/api/comfyui/view/a.png)"),
    ).toEqual([]);
    expect(
      extractComfyUIImageUrls("``code\n![code](/api/comfyui/view/a.png)``"),
    ).toEqual([]);
    expect(
      extractComfyUIImageUrls("\\![escaped](/api/comfyui/view/a.png)"),
    ).toEqual([]);
  });

  test("finds reference images and ignores image titles", () => {
    expect(
      extractComfyUIImageUrls('![image](/api/comfyui/view/a.png "title")'),
    ).toEqual(["/api/comfyui/view/a.png"]);
    expect(
      extractComfyUIImageUrls(
        "![image][generated]\n\n[generated]: /api/comfyui/view/a.png",
      ),
    ).toEqual(["/api/comfyui/view/a.png"]);
  });

  test("keys URLs by the image they load", () => {
    const key = comfyUIImageKey("/api/comfyui/view/a.png?type=output");
    expect(comfyUIImageKey("/api/comfyui/view/a.png")).toBe(key);
    expect(
      comfyUIImageKey("/api/comfyui/view/a.png?subfolder=&type=output"),
    ).toBe(key);
    expect(comfyUIImageKey("/api/comfyui/view/a.png?subfolder=b")).not.toBe(
      key,
    );
    expect(comfyUIImageKey("/api/comfyui/view/a.png?type=temp")).not.toBe(key);
  });
});
