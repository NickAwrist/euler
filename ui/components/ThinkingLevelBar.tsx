import { Check, ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { cx } from "../styles";
import type { ModelReasoning } from "../types";
import { AnchoredPopover } from "./AnchoredPopover";

export type ThinkingTier = "off" | "low" | "medium" | "high" | "xhigh" | "max";

interface EffortDefinition {
  label: string;
  level: number;
  tier: ThinkingTier;
}

const EFFORT_CONFIG: Readonly<Record<string, EffortDefinition>> = {
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

const LEVEL_TO_TIER: readonly ThinkingTier[] = [
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

const TIER_COLOR_CLASSES: Readonly<Record<ThinkingTier, string | undefined>> = {
  off: "opacity-40 text-muted-foreground",
  low: undefined,
  medium: undefined,
  high: undefined,
  xhigh: "text-purple-400",
  max: "text-red-400",
};

const BRAIN_OUTER_LOBE_PATHS = [
  { id: "outer-1", d: "M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" },
  { id: "outer-2", d: "M17.997 5.125a4 4 0 0 1 2.526 5.77" },
  { id: "outer-3", d: "M18 18a4 4 0 0 0 2-7.464" },
  { id: "outer-4", d: "M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" },
  { id: "outer-5", d: "M6 18a4 4 0 0 1-2-7.464" },
  { id: "outer-6", d: "M6.003 5.125a4 4 0 0 0-2.526 5.77" },
] as const;

const BRAIN_CENTER_FISSURE_PATH = "M12 18V5";

const BRAIN_INNER_FOLD_PATHS = [
  { id: "fold-1", d: "M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" },
  { id: "fold-2", d: "M16 10a2 2 0 0 0-2-2" },
  { id: "fold-3", d: "M8 10a2 2 0 0 1 2-2" },
] as const;

function getTierSvgChildren(tier: ThinkingTier) {
  const outerLobes = BRAIN_OUTER_LOBE_PATHS.map((item) => (
    <path key={item.id} d={item.d} />
  ));

  switch (tier) {
    case "off":
      return [
        ...outerLobes,
        <line key="slash" x1="3.5" y1="3.5" x2="20.5" y2="20.5" />,
      ];
    case "low":
      return outerLobes;
    case "medium":
      return [
        <path key="fissure" d={BRAIN_CENTER_FISSURE_PATH} />,
        ...outerLobes,
      ];
    case "high":
    case "xhigh":
    case "max":
      return [
        <path key="fissure" d={BRAIN_CENTER_FISSURE_PATH} />,
        ...BRAIN_INNER_FOLD_PATHS.map((item) => (
          <path key={item.id} d={item.d} />
        )),
        ...outerLobes,
      ];
  }
}

export function BrainTierIcon({
  effort,
  level,
  tier,
  className,
  size = 16,
}: {
  effort?: string | null;
  level?: number;
  tier?: ThinkingTier;
  className?: string;
  size?: number;
}) {
  const resolvedTier = tier ?? normalizeThinkingTier(effort, level);
  const colorClass = TIER_COLOR_CLASSES[resolvedTier];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("shrink-0", colorClass, className)}
      aria-hidden="true"
    >
      {getTierSvgChildren(resolvedTier)}
    </svg>
  );
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

export function ThinkingLevelBar({
  reasoning,
  value,
  onChange,
  disabled,
}: {
  reasoning: ModelReasoning;
  value: string | null | undefined;
  onChange: (effort: string) => void;
  disabled: boolean;
}) {
  const options = useMemo(() => buildThinkingOptions(reasoning), [reasoning]);
  const effectiveValue = resolveEffectiveOptionFromList(
    options,
    reasoning,
    value,
  );

  const currentOption =
    (effectiveValue
      ? options.find(
          (o) => o.value.toLowerCase() === effectiveValue.toLowerCase(),
        )
      : null) ?? options[0];

  if (options.length <= 1) return null;

  return (
    <AnchoredPopover
      disabled={disabled}
      ariaLabel="Thinking level"
      panelClassName="thinking-level-picker"
      maxHeight={280}
      onOpen={(panel) => {
        const activeItem =
          panel.querySelector<HTMLButtonElement>(
            '[data-thinking-option][aria-checked="true"]',
          ) ?? panel.querySelector<HTMLButtonElement>("[data-thinking-option]");
        activeItem?.focus();
      }}
      onPanelKeyDown={(event) => {
        if (
          event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "Home" ||
          event.key === "End"
        ) {
          event.preventDefault();
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "[data-thinking-option]",
            ),
          );
          if (items.length === 0) return;
          const activeIndex = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          let nextIndex = 0;
          if (event.key === "ArrowDown") {
            nextIndex = activeIndex >= 0 ? (activeIndex + 1) % items.length : 0;
          } else if (event.key === "ArrowUp") {
            nextIndex = activeIndex > 0 ? activeIndex - 1 : items.length - 1;
          } else if (event.key === "Home") {
            nextIndex = 0;
          } else if (event.key === "End") {
            nextIndex = items.length - 1;
          }
          items[nextIndex]?.focus();
        }
      }}
      renderTrigger={({ ref, popoverTarget, isOpen, open: openMenu }) => (
        <button
          ref={ref}
          id="run-thinking-level"
          type="button"
          popoverTarget={popoverTarget}
          aria-label={`Thinking level: ${currentOption?.label ?? "Default"}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={popoverTarget}
          disabled={disabled}
          title={`Thinking level: ${currentOption?.label ?? "Default"}`}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.8125rem] text-muted-foreground outline-none focus:outline-none focus-visible:outline-2 focus-visible:outline-accent-ring transition-[background-color,color] duration-150 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              openMenu();
            }
          }}
        >
          <BrainTierIcon
            effort={currentOption?.value ?? "off"}
            level={currentOption?.level ?? 0}
            size={14}
          />
          <span className="truncate">{currentOption?.label ?? "Thinking"}</span>
          <ChevronDown
            size={12}
            className={cx(
              "shrink-0 transition-transform duration-150",
              isOpen && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground/75">
            Brain Level
          </div>
          <div
            role="menu"
            aria-label="Thinking levels"
            className="flex flex-col gap-0.5 p-0.5"
          >
            {options.map((option) => {
              const isSelected =
                effectiveValue?.toLowerCase() === option.value.toLowerCase();
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  data-thinking-option
                  aria-checked={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  className={cx(
                    "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-ring",
                    isSelected
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/40 focus-visible:text-foreground",
                  )}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                >
                  <BrainTierIcon
                    effort={option.value}
                    level={option.level}
                    size={16}
                  />
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.isDefault && (
                    <span className="text-[0.625rem] uppercase text-muted-foreground/60">
                      Default
                    </span>
                  )}
                  {isSelected && (
                    <Check
                      size={13}
                      className="shrink-0 text-foreground"
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </AnchoredPopover>
  );
}
