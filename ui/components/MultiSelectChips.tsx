import type { ComponentType, ReactNode } from "react";
import { cx } from "../styles";

export interface MultiSelectChipsProps<T> {
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  items: readonly T[];
  selected: readonly string[];
  getId: (item: T) => string;
  getLabel: (item: T) => ReactNode;
  onToggle: (id: string) => void;
  helpText?: ReactNode;
  className?: string;
}

export function MultiSelectChips<T>({
  label,
  icon: Icon,
  items,
  selected,
  getId,
  getLabel,
  onToggle,
  helpText,
  className,
}: MultiSelectChipsProps<T>) {
  return (
    <fieldset className={cx("flex flex-col gap-2", className)}>
      <legend className="mb-1 flex items-center gap-1.5 text-[0.75rem] font-medium text-muted-foreground">
        {Icon && <Icon size={13} />}
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const id = getId(item);
          const active = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(id)}
              className={cx(
                "rounded-md border px-2.5 py-1 text-[0.75rem] font-medium transition-colors duration-150",
                active
                  ? "border-accent/30 bg-accent-soft-strong text-foreground"
                  : "border-border-subtle bg-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {getLabel(item)}
            </button>
          );
        })}
      </div>
      {helpText && (
        <p className="text-[0.6875rem] leading-snug text-muted-foreground">
          {helpText}
        </p>
      )}
    </fieldset>
  );
}
