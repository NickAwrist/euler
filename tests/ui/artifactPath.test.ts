import { expect, test } from "bun:test";
import { artifactPath } from "../../ui/components/Artifacts/ArtifactContext";
test("chat artifact paths map workspace paths without capturing web links", () => {
  expect(artifactPath("/workspace/docs/a.md")).toBe("docs/a.md");
  expect(artifactPath("/home/nick/project/a.md", "/home/nick/project")).toBe(
    "a.md",
  );
  expect(artifactPath("./hello%20world.md#heading")).toBe("hello world.md");
  for (const path of [
    "https://example.com/a.md",
    "//example.com/a.md",
    "#heading",
    "../a.md",
    "/etc/passwd",
    "javascript:alert(1)",
  ])
    expect(artifactPath(path)).toBeNull();
});
