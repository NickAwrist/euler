import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useMobileLayout } from "../hooks/useMobileLayout";
import { cx } from "../styles";
import { AnchoredPopover } from "./AnchoredPopover";

/** Top-level progress entry; sections with several steps list them while active. */
export type OnboardingSection = {
  title: string;
  summary: string;
  steps: { title: string }[];
};

type Props = {
  sections: OnboardingSection[];
  /** Index across every section's steps. */
  step: number;
  busy: boolean;
  onSelectStep: (step: number) => void;
  content: ReactNode;
  actions: ReactNode;
};

type NavProps = Pick<Props, "sections" | "step" | "busy" | "onSelectStep"> & {
  /** Section index of each step. */
  owners: number[];
};

/** Earlier steps are links back; the current and later steps are plain text. */
function StepLink({
  target,
  step,
  busy,
  onSelectStep,
  className,
  children,
}: Omit<NavProps, "sections" | "owners"> & {
  target: number;
  className: string;
  children: ReactNode;
}) {
  const base = "flex w-full items-start gap-2.5 rounded-lg px-2 text-left";
  return target < step ? (
    <button
      type="button"
      disabled={busy}
      onClick={() => onSelectStep(target)}
      className={cx(
        base,
        className,
        "transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed",
      )}
    >
      {children}
    </button>
  ) : (
    <div className={cx(base, className)}>{children}</div>
  );
}

function SetupNav({ sections, owners, step, busy, onSelectStep }: NavProps) {
  const link = { step, busy, onSelectStep };
  return (
    <ol aria-label="Setup progress" className="space-y-1">
      {sections.map((section, index) => {
        const start = owners.indexOf(index);
        const end = owners.lastIndexOf(index);
        const active = step >= start && step <= end;
        const grouped = section.steps.length > 1;
        return (
          <li
            key={section.title}
            aria-current={active && !grouped ? "step" : undefined}
          >
            <StepLink
              {...link}
              target={start}
              className={cx(
                "py-2",
                active ? "text-foreground" : "text-muted-foreground",
                active && !grouped && "bg-muted",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] tabular-nums transition-colors duration-200",
                  step > end
                    ? "border-foreground bg-foreground text-background"
                    : active
                      ? "border-foreground text-foreground"
                      : "border-border",
                )}
              >
                {step > end ? <Check size={12} strokeWidth={3} /> : index + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={cx(
                    "block text-[0.8125rem]",
                    active && "font-medium",
                  )}
                >
                  {section.title}
                </span>
                <span className="mt-0.5 block truncate text-[0.75rem] text-muted-foreground">
                  {section.summary}
                </span>
              </span>
            </StepLink>
            {active && grouped && (
              <ol className="mt-0.5 space-y-0.5">
                {section.steps.map((item, offset) => {
                  const target = start + offset;
                  return (
                    <li
                      key={item.title}
                      aria-current={target === step ? "step" : undefined}
                    >
                      <StepLink
                        {...link}
                        target={target}
                        className={cx(
                          "py-1.5 text-[0.8125rem]",
                          target === step
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <span
                          aria-hidden
                          className="flex h-5 w-5 shrink-0 items-center justify-center"
                        >
                          {target < step ? (
                            <Check size={12} strokeWidth={3} />
                          ) : (
                            <span
                              className={cx(
                                "size-1.5 rounded-full",
                                target === step ? "bg-foreground" : "bg-border",
                              )}
                            />
                          )}
                        </span>
                        {item.title}
                      </StepLink>
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Lays out setup progress beside the current step, with actions pinned to the
 * same place on every step; owns no setup state.
 */
export function OnboardingShell({
  sections,
  step,
  busy,
  onSelectStep,
  content,
  actions,
}: Props) {
  const scroller = useRef<HTMLElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [step]);
  const mobile = useMobileLayout();
  const owners = sections.flatMap((section, index) =>
    section.steps.map(() => index),
  );
  const brand = (
    <span className="text-[0.9375rem] font-semibold tracking-tight">Euler</span>
  );
  const nav = { sections, owners, step, busy };

  if (mobile) {
    const section = owners[step] ?? 0;
    return (
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <header className="space-y-3 px-5 pt-4 pb-1">
          <div className="flex items-center justify-between">
            {brand}
            <AnchoredPopover
              ariaLabel="Setup steps"
              panelClassName="w-[min(20rem,calc(100vw-16px))] overflow-y-auto rounded-xl p-2 shadow-2xl shadow-black/30"
              maxHeight={480}
              renderTrigger={({ ref, popoverTarget, isOpen }) => (
                <button
                  ref={ref}
                  type="button"
                  popoverTarget={popoverTarget}
                  aria-haspopup="dialog"
                  aria-expanded={isOpen}
                  aria-label={`Setup steps, ${section + 1} of ${sections.length}`}
                  className="-mr-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[0.75rem] tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-ring"
                >
                  {section + 1} of {sections.length}
                  <ChevronDown
                    size={14}
                    aria-hidden
                    className={cx(
                      "transition-transform duration-150",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
              )}
            >
              {({ close }) => (
                <SetupNav
                  {...nav}
                  onSelectStep={(target) => {
                    close(false);
                    onSelectStep(target);
                  }}
                />
              )}
            </AnchoredPopover>
          </div>
          <div aria-hidden className="flex gap-1">
            {sections.map((item, index) => (
              <span
                key={item.title}
                className={cx(
                  "h-1 flex-1 rounded-full transition-colors duration-200",
                  index <= section ? "bg-foreground" : "bg-border-subtle",
                )}
              />
            ))}
          </div>
        </header>
        <main
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 pb-8"
        >
          {content}
        </main>
        <footer className="flex items-center gap-2 border-t border-border-subtle px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {actions}
        </footer>
      </div>
    );
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div className="flex h-full max-h-[44rem] w-full max-w-5xl overflow-hidden rounded-2xl border border-border-subtle shadow-2xl shadow-black/20">
        <aside className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border-subtle bg-surface/50 p-4">
          <div className="px-2 pt-1">{brand}</div>
          <nav aria-label="Setup steps">
            <SetupNav {...nav} onSelectStep={onSelectStep} />
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <main ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-10 py-9">{content}</div>
          </main>
          <footer className="flex items-center gap-2 border-t border-border-subtle px-10 py-4">
            {actions}
          </footer>
        </div>
      </div>
    </div>
  );
}
