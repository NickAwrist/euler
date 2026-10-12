import { Plug, Wrench } from "lucide-react";
import type { DisplayIcon } from "../../src/schemas/icons";
import { ServiceIcon } from "./ServiceIcon";

export function ToolIcon({
  name,
  icons,
  size = 14,
  className,
}: {
  name?: string;
  icons?: readonly DisplayIcon[];
  size?: number;
  className?: string;
}) {
  return (
    <ServiceIcon
      icons={icons}
      fallback={name?.startsWith("mcp__") ? Plug : Wrench}
      size={size}
      className={className}
    />
  );
}
