import { expect, test } from "bun:test";
import { parseRoute } from "../ui/lib/navigation";

test("customization routes select a section and default to personalization", () => {
  for (const tab of ["personalization", "skills", "tools"] as const) {
    expect(parseRoute(`/customization/${tab}`)).toEqual({
      view: "customization",
      tab,
    });
  }
  for (const path of ["/customization", "/customization/unknown"]) {
    expect(parseRoute(path)).toEqual({
      view: "customization",
      tab: "personalization",
    });
  }
  expect(parseRoute("/customization-other")).toEqual({
    view: "run",
    sessionId: null,
  });
});
