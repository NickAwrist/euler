import type { ModelReasoning } from "../types";

export type ThinkingTier = "off" | "low" | "medium" | "high" | "xhigh" | "max";

export interface EffortDefinition {
  label: string;
  level: number;
  tier: ThinkingTier;
}

/**
 * Maps known OpenRouter reasoning effort tokens to their tier, UI label, and numeric sorting level.
 * Both "off" and "none" map to tier "off" (level 0). Models specifying "none" in supported_efforts
 * use "none" as the wire value, while synthesized disabled options and models specifying "off" use "off".
 */
export const EFFORT_CONFIG: Readonly<Record<string, EffortDefinition>> = {
  off: { label: "Off", level: 0, tier: "off" },
  none: { label: "Off", level: 0, tier: "off" },
  minimal: { label: "Minimal", level: 1, tier: "low" },
  low: { label: "Low", level: 2, tier: "low" },
  medium: { label: "Medium", level: 3, tier: "medium" },
  on: { label: "On", level: 3, tier: "medium" },
  high: { label: "High", level: 4, tier: "high" },
  xhigh: { label: "Extra High", level: 5, tier: "xhigh" },
  max: { label: "Maximum", level: 6, tier: "max" },
};

export const LEVEL_TO_TIER: readonly ThinkingTier[] = [
  "off",
  "low",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function normalizeThinkingTier(
  effort?: string | null,
  level?: number,
): ThinkingTier {
  const normalizedKey = effort?.trim().toLowerCase();
  if (normalizedKey && Object.hasOwn(EFFORT_CONFIG, normalizedKey)) {
    const def = EFFORT_CONFIG[normalizedKey];
    if (def) return def.tier;
  }

  if (typeof level === "number" && Number.isFinite(level)) {
    if (level <= 0) return "off";
    if (level >= LEVEL_TO_TIER.length) return "max";
    return LEVEL_TO_TIER[level] ?? "medium";
  }

  return "off";
}

export type ThinkingOption = {
  value: string;
  label: string;
  level: number;
  isDefault: boolean;
};

export function buildThinkingOptions(
  reasoning: ModelReasoning,
): ThinkingOption[] {
  const supported: string[] = reasoning.supportedEfforts ?? [];

  // Models with mandatory reasoning and no tiers have no choices.
  if (reasoning.mandatory && supported.length === 0) {
    return [];
  }

  // Binary models supporting only toggle on/off
  if (supported.length === 0) {
    return [
      {
        value: "off",
        label: "Off",
        level: 0,
        isDefault: reasoning.defaultEnabled === false,
      },
      {
        value: "on",
        label: "On",
        level: 3,
        isDefault: reasoning.defaultEnabled !== false,
      },
    ];
  }

  const options: ThinkingOption[] = [];
  const hasNoneOrOff = supported.some(
    (e: string) => e.toLowerCase() === "none" || e.toLowerCase() === "off",
  );

  if (!reasoning.mandatory && !hasNoneOrOff) {
    options.push({
      value: "off",
      label: "Off",
      level: 0,
      isDefault: reasoning.defaultEnabled === false,
    });
  }

  for (const effort of supported) {
    const key = effort.toLowerCase();
    const knownConfig = Object.hasOwn(EFFORT_CONFIG, key)
      ? EFFORT_CONFIG[key]
      : undefined;
    const config = knownConfig ?? {
      label: effort.charAt(0).toUpperCase() + effort.slice(1),
      level: 3,
      tier: "medium" as ThinkingTier,
    };
    options.push({
      // Preserve the exact provider effort token while standardizing "off" / "Off" to canonical "off".
      value: key === "off" ? "off" : effort,
      label: config.label,
      level: config.level,
      isDefault:
        reasoning.defaultEffort?.toLowerCase() === key ||
        (!reasoning.defaultEffort &&
          reasoning.defaultEnabled &&
          key === "high"),
    });
  }

  return options.sort((a, b) => a.level - b.level);
}

/**
 * Resolves the effective thinking effort from available options.
 * Resolution precedence:
 * 1. Exact case-insensitive value match with user preference (e.g. "low" === "low")
 * 2. Tier-level equivalence match (e.g. user preference "off" matches model's "none" option)
 * 3. Model default effort (direct match or tier match)
 * 4. Model disabled state fallback to "off"
 * 5. First default or active option
 */
export function resolveEffectiveOptionFromList(
  options: ThinkingOption[],
  reasoning: ModelReasoning,
  userPreference?: string | null,
): string | undefined {
  if (options.length <= 1) {
    return undefined;
  }

  if (userPreference) {
    const directMatch = options.find(
      (o) => o.value.toLowerCase() === userPreference.toLowerCase(),
    );
    if (directMatch) return directMatch.value;

    const prefTier = normalizeThinkingTier(userPreference);
    const tierMatch = options.find(
      (o) => normalizeThinkingTier(o.value) === prefTier,
    );
    if (tierMatch) return tierMatch.value;
  }

  if (reasoning.defaultEffort) {
    const directMatch = options.find(
      (o) => o.value.toLowerCase() === reasoning.defaultEffort!.toLowerCase(),
    );
    if (directMatch) return directMatch.value;

    const defaultTier = normalizeThinkingTier(reasoning.defaultEffort);
    const tierMatch = options.find(
      (o) => normalizeThinkingTier(o.value) === defaultTier,
    );
    if (tierMatch) return tierMatch.value;
  }

  if (!reasoning.mandatory && reasoning.defaultEnabled === false) {
    const offOption = options.find(
      (o) => normalizeThinkingTier(o.value) === "off",
    );
    return offOption?.value ?? "off";
  }

  const defaultOption =
    options.find((o) => o.isDefault) ??
    options.find((o) => o.level > 0) ??
    options[0];

  return defaultOption?.value ?? "off";
}

export function resolveEffectiveThinkingEffort(
  reasoning: ModelReasoning,
  userPreference?: string | null,
): string | undefined {
  const options = buildThinkingOptions(reasoning);
  return resolveEffectiveOptionFromList(options, reasoning, userPreference);
}

export function hasConfigurableThinking(reasoning: ModelReasoning): boolean {
  return buildThinkingOptions(reasoning).length > 1;
}
