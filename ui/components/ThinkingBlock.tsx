import { Brain, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { formatDuration } from "../lib/formatDuration";
import { cx } from "../styles";

/** Collapsible model reasoning. While `active`, it starts open and follows new text. */
export function ThinkingBlock({
  thinking,
  durationMs,
  active = false,
}: {
  thinking: string;
  durationMs?: number;
  active?: boolean;
}) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? active;
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (active && body) body.scrollTop = body.scrollHeight;
  }, [active, thinking]);

  const duration =
    durationMs !== undefined && durationMs >= 1000
      ? formatDuration(durationMs)
      : null;
  const label = active
    ? `Thinking${duration ? ` (${duration})` : ""}`
    : duration
      ? `Thought for ${duration}`
      : "Thoughts";

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setExpanded(!open)}
        className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
      >
        <Brain
          size={14}
          aria-hidden
          className={cx(active && "animate-pulse")}
        />
        <span className="tabular-nums">{label}</span>
        <ChevronRight
          size={13}
          aria-hidden
          className={cx(
            "transition-transform duration-150",
            open && "rotate-90",
          )}
        />
      </button>
      <div
        id={bodyId}
        ref={bodyRef}
        hidden={!open}
        className="mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border-subtle pl-3 text-[0.8125rem] leading-[1.6] text-muted-foreground"
      >
        {thinking}
      </div>
    </div>
  );
}
