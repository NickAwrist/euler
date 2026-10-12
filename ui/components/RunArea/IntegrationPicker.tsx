import { useLayoutEffect, useRef } from "react";
import { cx } from "../../styles";
import { ServiceIcon } from "../ServiceIcon";
import type { ComposerSuggestion } from "../composerSuggestions";

export function IntegrationPicker({
  id,
  label,
  options,
  selectedIndex,
  onSelectIndex,
  status,
}: {
  id: string;
  label: string;
  options: readonly ComposerSuggestion[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  status?: string;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div
      id={id}
      aria-label={label}
      className="ui-animate-slide-up absolute inset-x-0 bottom-[calc(100%+8px)] z-40 overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-[0_14px_36px_rgba(0,0,0,0.42)]"
    >
      <div className="max-h-64 overflow-y-auto p-1.5">
        {options.map((option, index) => (
          <button
            key={option.id}
            ref={index === selectedIndex ? selectedRef : undefined}
            type="button"
            aria-current={index === selectedIndex}
            title={option.label}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onSelectIndex(index)}
            onClick={option.select}
            className={cx(
              "flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left",
              index === selectedIndex
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <ServiceIcon icons={option.icons} fallback={option.icon} />
            <span className="min-w-0 truncate font-mono text-[0.8125rem] text-foreground">
              {option.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs">
              {option.description}
            </span>
          </button>
        ))}
        {status && (
          <output className="block px-2.5 py-2 text-xs text-muted-foreground">
            {status}
          </output>
        )}
      </div>
    </div>
  );
}
