import { cx } from "../styles";
import type { ModelOption } from "../types";

type CapabilityModel = Pick<
  ModelOption,
  "inputCapabilities" | "supportsTools" | "reasoning"
>;

export function modelCapabilities(model: CapabilityModel): string[] {
  const capabilities: string[] = [];
  if (model.inputCapabilities.includes("image")) capabilities.push("Vision");
  if (model.supportsTools) capabilities.push("Tools");
  if (model.reasoning) capabilities.push("Thinking");
  return capabilities;
}

const compactNumber = Intl.NumberFormat("en", { notation: "compact" });

export function formatContextLength(tokens: number): string {
  return `${compactNumber.format(tokens)} context`;
}

export function ModelCapabilityBadges({
  model,
  className,
}: {
  model: CapabilityModel;
  className?: string;
}) {
  const capabilities = modelCapabilities(model);
  if (capabilities.length === 0) return null;
  return (
    <span className={cx("inline-flex flex-wrap gap-1", className)}>
      {capabilities.map((capability) => (
        <span
          key={capability}
          className="rounded border border-border-subtle px-1 py-px text-[10px] leading-none text-muted-foreground"
        >
          {capability}
        </span>
      ))}
    </span>
  );
}
