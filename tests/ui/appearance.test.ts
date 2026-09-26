import { describe, expect, test } from "bun:test";
import { parseRoute } from "../../ui/lib/navigation";
import { type Appearance, appearanceSchema } from "../../ui/persist/appearance";

const defaults: Appearance = {
  theme: "default",
  font: "default",
  chatWidth: "standard",
  codeFont: "default",
  shiftForChatList: false,
  shiftForArtifacts: false,
  sidebarAnimationMs: 300,
};

describe("appearance preferences", () => {
  test("invalid fields fall back independently without losing valid preferences", () => {
    expect(appearanceSchema.parse({ theme: "nord", font: 42 })).toEqual({
      ...defaults,
      theme: "nord",
    });
    expect(appearanceSchema.parse({ theme: "retired", font: "serif" })).toEqual(
      { ...defaults, font: "serif" },
    );
    expect(appearanceSchema.parse({})).toEqual(defaults);
    expect(appearanceSchema.safeParse(null).success).toBe(false);
  });

  test("code font validates independently from interface font", () => {
    expect(
      appearanceSchema.parse({ font: "geist", codeFont: "jetbrains-mono" }),
    ).toEqual({ ...defaults, font: "geist", codeFont: "jetbrains-mono" });
    expect(
      appearanceSchema.parse({ font: "atkinson", codeFont: "invalid" }),
    ).toEqual({ ...defaults, font: "atkinson" });
  });

  test("chat width accepts supported sizes and defaults older or invalid preferences", () => {
    for (const chatWidth of [
      "standard",
      "comfortable",
      "wide",
      "full",
    ] as const) {
      expect(appearanceSchema.parse({ chatWidth }).chatWidth).toBe(chatWidth);
    }
    expect(
      appearanceSchema.parse({ chatWidth: "huge", theme: "nord" }),
    ).toMatchObject({
      chatWidth: "standard",
      theme: "nord",
    });
  });

  test("sidebar animation keeps whole milliseconds from 0 to 600", () => {
    for (const sidebarAnimationMs of [0, 600]) {
      expect(
        appearanceSchema.parse({ sidebarAnimationMs }).sidebarAnimationMs,
      ).toBe(sidebarAnimationMs);
    }
    for (const sidebarAnimationMs of [-1, 601, 12.5, "200"]) {
      expect(
        appearanceSchema.parse({ sidebarAnimationMs }).sidebarAnimationMs,
      ).toBe(300);
    }
  });

  test("Appearance has a direct settings route", () => {
    expect(parseRoute("/settings/appearance")).toEqual({
      view: "settings",
      tab: "appearance",
    });
  });
});
