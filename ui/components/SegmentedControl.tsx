import type { ReactNode } from "react";
import { cx } from "../styles";
import "./SegmentedControl.css";

export type SegmentedOption<Value extends string> = {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
};

export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className,
}: {
  label: string;
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (!options.length) return null;
  const index = options.findIndex((option) => option.value === value);
  return (
    <fieldset
      aria-label={label}
      className={cx("segmented-control", className)}
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {index >= 0 && (
        <span
          aria-hidden="true"
          className="segmented-control-highlight"
          style={{
            width: `calc((100% - 6px) / ${options.length})`,
            transform: `translateX(${index * 100}%)`,
          }}
        />
      )}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled || option.disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
