import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { type DisplayIcon, DisplayIconSchema } from "../../src/schemas/icons";
import { cx } from "../styles";

/** Native icon selection, validation, and image failure handling live here. */
export function ServiceIcon({
  icons,
  fallback: Fallback,
  size = 14,
  className,
}: {
  icons?: readonly DisplayIcon[];
  fallback: LucideIcon;
  size?: number;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  // Validate at display time too, since historical traces can predate the contract.
  const validIcons =
    DisplayIconSchema.array().safeParse(icons ?? []).data ?? [];
  // All current application themes use dark backgrounds.
  const icon =
    validIcons.find((value) => value.theme === "dark") ??
    validIcons.find((value) => !value.theme) ??
    validIcons[0];
  const src = icon?.src;
  return src && src !== failedUrl ? (
    <img
      src={src}
      alt=""
      aria-hidden
      referrerPolicy="no-referrer"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cx("shrink-0 object-contain", className)}
      onError={() => setFailedUrl(src)}
    />
  ) : (
    <Fallback size={size} className={cx("shrink-0", className)} aria-hidden />
  );
}
