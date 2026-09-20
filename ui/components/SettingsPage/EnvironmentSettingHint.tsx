import type { ReactNode } from "react";
import { hintClass } from "./constants";

export function EnvironmentSettingHint({
  id,
  managed,
  children,
}: {
  id: string;
  managed: boolean | undefined;
  children?: ReactNode;
}) {
  return (
    <p id={id} className={hintClass}>
      {managed === undefined
        ? "Checking environment settings..."
        : managed
          ? "Managed by the environment."
          : children}
    </p>
  );
}
