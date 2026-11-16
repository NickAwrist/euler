import { Plug, Wrench } from "lucide-react";
import type { DisplayIcon } from "../../src/gen/euler/v1/common_pb";
import { ServiceIcon } from "./ServiceIcon";

export function ToolIcon({
  name,
  icons,
  size = 14,
}: {
  name?: string;
  icons?: readonly Pick<DisplayIcon, "src" | "theme">[];
  size?: number;
}) {
  return (
    <ServiceIcon
      icons={icons}
      fallback={name?.startsWith("mcp__") ? Plug : Wrench}
      size={size}
    />
  );
}
