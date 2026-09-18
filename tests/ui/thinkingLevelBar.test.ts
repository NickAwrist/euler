import { describe, expect, test } from "bun:test";
import {
  BrainTierIcon,
  buildThinkingOptions,
  hasConfigurableThinking,
  normalizeThinkingTier,
  resolveEffectiveThinkingEffort,
} from "../../ui/components/ThinkingLevelBar";

describe("ThinkingLevelBar options builder", () => {
  test("generates options including Off for non-mandatory reasoning models", () => {
    const options = buildThinkingOptions({
      mandatory: false,
      defaultEnabled: true,
      supportedEfforts: ["high", "medium", "low"],
      defaultEffort: "high",
    });

    expect(options).toEqual([
      { value: "off", label: "Off", level: 0, isDefault: false },
      { value: "low", label: "Low", level: 2, isDefault: false },
      { value: "medium", label: "Medium", level: 3, isDefault: false },
      { value: "high", label: "High", level: 4, isDefault: true },
    ]);
  });

  test("excludes Off when reasoning is mandatory", () => {
    const options = buildThinkingOptions({
      mandatory: true,
      defaultEnabled: true,
      supportedEfforts: ["max", "high", "medium", "low"],
      defaultEffort: "medium",
    });

    expect(options.map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(options.some((o) => o.value === "off")).toBeFalse();
    expect(options.find((o) => o.value === "medium")?.isDefault).toBeTrue();
  });

  test("returns empty options when reasoning is mandatory with no tiers", () => {
    const options = buildThinkingOptions({
      mandatory: true,
      defaultEnabled: true,
      supportedEfforts: [],
    });
    expect(options).toEqual([]);
    expect(
      hasConfigurableThinking({
        mandatory: true,
        defaultEnabled: true,
        supportedEfforts: [],
      }),
    ).toBeFalse();
    expect(
      resolveEffectiveThinkingEffort({
        mandatory: true,
        defaultEnabled: true,
        supportedEfforts: [],
      }),
    ).toBeUndefined();
  });

  test("does not duplicate Off when supported_efforts includes none", () => {
    const options = buildThinkingOptions({
      mandatory: false,
      defaultEnabled: false,
      supportedEfforts: ["none", "high"],
      defaultEffort: "none",
    });

    expect(options).toEqual([
      { value: "none", label: "Off", level: 0, isDefault: true },
      { value: "high", label: "High", level: 4, isDefault: false },
    ]);
  });

  test("generates binary toggle when supportedEfforts is empty and mandatory is false", () => {
    const nonMandatory = buildThinkingOptions({
      mandatory: false,
      defaultEnabled: true,
      supportedEfforts: [],
    });

    expect(nonMandatory).toEqual([
      { value: "off", label: "Off", level: 0, isDefault: false },
      { value: "on", label: "On", level: 3, isDefault: true },
    ]);
    expect(
      hasConfigurableThinking({
        mandatory: false,
        defaultEnabled: true,
        supportedEfforts: [],
      }),
    ).toBeTrue();
  });

  test("resolves effective thinking effort accurately", () => {
    const tiered = {
      mandatory: false,
      defaultEnabled: true,
      supportedEfforts: ["high", "medium", "low"],
      defaultEffort: "high",
    };

    // User preference matches case-insensitively
    expect(resolveEffectiveThinkingEffort(tiered, "LOW")).toBe("low");
    expect(resolveEffectiveThinkingEffort(tiered, "OFF")).toBe("off");

    // Falls back to default effort
    expect(resolveEffectiveThinkingEffort(tiered, null)).toBe("high");

    // Falls back to high when defaultEnabled is true but defaultEffort is undefined
    const noDefaultEffort = {
      mandatory: false,
      defaultEnabled: true,
      supportedEfforts: ["high", "medium", "low"],
    };
    expect(resolveEffectiveThinkingEffort(noDefaultEffort, null)).toBe("high");

    // Falls back to off when defaultEnabled is false
    const defaultOff = {
      mandatory: false,
      defaultEnabled: false,
      supportedEfforts: ["high", "medium", "low"],
    };
    expect(resolveEffectiveThinkingEffort(defaultOff, null)).toBe("off");
  });

  test("BrainTierIcon renders appropriate SVG elements and color classes for tiers", () => {
    const off = BrainTierIcon({ effort: "off", level: 0 });
    expect(off.props.className).toContain("opacity-40");
    const offChildren = off.props.children as Array<{
      type: string;
      props: Record<string, unknown>;
    }>;
    expect(offChildren.some((child) => child.type === "line")).toBeTrue();

    const low = BrainTierIcon({ effort: "low", level: 2 });
    expect(low.props.className).not.toContain("text-purple-400");
    expect(low.props.className).not.toContain("text-red-400");
    const lowChildren = low.props.children as Array<{
      type: string;
      props: { d?: string };
    }>;
    // Low has convoluted outer lobes matching medium
    expect(
      lowChildren.some((child) =>
        child.props?.d?.includes("M17.598 6.5A3 3 0 1 0 12 5"),
      ),
    ).toBeTrue();
    // Low omits the center fissure line present in medium
    expect(
      lowChildren.some((child) => child.props?.d === "M12 18V5"),
    ).toBeFalse();
    // Low omits the inner sulcal folds present in high
    expect(
      lowChildren.some((child) => child.props?.d?.includes("M15 13a4.17 4.17")),
    ).toBeFalse();

    const medium = BrainTierIcon({ effort: "medium", level: 3 });
    expect(medium.props["aria-hidden"]).toBe("true");
    const medChildren = medium.props.children as Array<{
      type: string;
      props: { d?: string };
    }>;
    expect(
      medChildren.some((child) =>
        child.props?.d?.includes("M17.598 6.5A3 3 0 1 0 12 5"),
      ),
    ).toBeTrue();
    // Medium includes the center fissure line
    expect(
      medChildren.some((child) => child.props?.d === "M12 18V5"),
    ).toBeTrue();
    expect(
      medChildren.some((child) => child.props?.d?.includes("M15 13a4.17 4.17")),
    ).toBeFalse();

    const high = BrainTierIcon({ effort: "high", level: 4 });
    expect(high.props.className).not.toContain("text-purple-400");
    const highChildren = high.props.children as Array<{
      type: string;
      props: { d?: string };
    }>;
    expect(
      highChildren.some((child) =>
        child.props?.d?.includes("M15 13a4.17 4.17 0 0 1-3-4"),
      ),
    ).toBeTrue();
    expect(
      highChildren.some((child) => child.props?.d === "M12 18V5"),
    ).toBeTrue();

    const xhigh = BrainTierIcon({ effort: "xhigh", level: 5 });
    expect(xhigh.props.className).toContain("text-purple-400");

    const max = BrainTierIcon({ effort: "max", level: 6 });
    expect(max.props.className).toContain("text-red-400");
  });

  test("normalizeThinkingTier normalizes effort strings and levels accurately", () => {
    // Strings case-insensitively
    expect(normalizeThinkingTier("OFF")).toBe("off");
    expect(normalizeThinkingTier("none")).toBe("off");
    expect(normalizeThinkingTier("minimal")).toBe("low");
    expect(normalizeThinkingTier("low")).toBe("low");
    expect(normalizeThinkingTier("medium")).toBe("medium");
    expect(normalizeThinkingTier("on")).toBe("medium");
    expect(normalizeThinkingTier("high")).toBe("high");
    expect(normalizeThinkingTier("xhigh")).toBe("xhigh");
    expect(normalizeThinkingTier("max")).toBe("max");

    // Level fallback when effort is unknown or absent
    expect(normalizeThinkingTier(undefined, 0)).toBe("off");
    expect(normalizeThinkingTier(null, 1)).toBe("low");
    expect(normalizeThinkingTier(null, 2)).toBe("low");
    expect(normalizeThinkingTier(null, 3)).toBe("medium");
    expect(normalizeThinkingTier(null, 4)).toBe("high");
    expect(normalizeThinkingTier(null, 5)).toBe("xhigh");
    expect(normalizeThinkingTier(null, 6)).toBe("max");
    expect(normalizeThinkingTier("custom", 6)).toBe("max");
    expect(normalizeThinkingTier(undefined, undefined)).toBe("off");

    // Prototype safety
    expect(normalizeThinkingTier("toString")).toBe("off");
    expect(normalizeThinkingTier("valueOf")).toBe("off");
    expect(normalizeThinkingTier("constructor")).toBe("off");
  });

  test("resolves off and none interoperably across user preferences and model defaults", () => {
    const modelWithNone = {
      mandatory: false,
      defaultEnabled: true,
      supportedEfforts: ["none", "low", "high"],
      defaultEffort: "high",
    };

    // User preference "off" correctly matches option "none"
    expect(resolveEffectiveThinkingEffort(modelWithNone, "off")).toBe("none");

    const modelWithOff = {
      mandatory: false,
      defaultEnabled: true,
      supportedEfforts: ["off", "low", "high"],
      defaultEffort: "high",
    };

    // User preference "none" correctly matches option "off"
    expect(resolveEffectiveThinkingEffort(modelWithOff, "none")).toBe("off");
  });
});
