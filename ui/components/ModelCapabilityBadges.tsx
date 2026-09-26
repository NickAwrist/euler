import { Brain, Eye, type LucideIcon, Wrench } from "lucide-react";
import { cx } from "../styles";
import type { ModelOption } from "../types";

type CapabilityModel = Pick<
  ModelOption,
  "inputCapabilities" | "supportsTools" | "reasoning"
>;

type ModelCapability = "Vision" | "Tools" | "Thinking";

const CAPABILITY_ICONS: Record<ModelCapability, LucideIcon> = {
  Vision: Eye,
  Tools: Wrench,
  Thinking: Brain,
};

export function modelCapabilities(model: CapabilityModel): ModelCapability[] {
  const capabilities: ModelCapability[] = [];
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
    <span className={cx("inline-flex items-center gap-1.5", className)}>
      {capabilities.map((capability) => {
        const Icon = CAPABILITY_ICONS[capability];
        return (
          <span
            key={capability}
            role="img"
            aria-label={capability}
            title={capability}
            className="text-muted-foreground"
          >
            <Icon size={13} aria-hidden />
          </span>
        );
      })}
    </span>
  );
}
