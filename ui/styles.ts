export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const eyebrowText =
  "text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground";

export const modalShell =
  "fixed inset-0 z-50 m-0 [&:not([open])]:hidden flex h-screen max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/55 p-4 text-foreground backdrop-blur-[8px] sm:p-[10px] ui-animate-modal-shell";

export const modalSurface =
  "max-h-[calc(100vh-32px)] rounded-xl border border-border-subtle bg-surface ui-animate-modal-panel";

export const modalHeader =
  "flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-[18px] py-[14px] sm:px-3.5 sm:py-3.5";

export const modalCloseButton =
  "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.94] active:bg-muted/80";

export const debugBlock =
  "rounded-lg border border-border-subtle bg-background px-[14px] py-3 text-[0.8125rem] leading-[1.6] text-foreground";

export const inputClass =
  "disabled:cursor-not-allowed disabled:opacity-60 flex h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[0.875rem] text-foreground placeholder:text-muted-foreground transition-colors focus:border-border focus:outline-none";

export const selectClass =
  "flex h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[0.875rem] text-foreground transition-colors focus:border-border focus:outline-none";

export const textareaClass =
  "flex w-full rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-[0.875rem] leading-[1.6] text-foreground placeholder:text-muted-foreground transition-colors focus:border-border focus:outline-none";

export const hintClass = "text-[0.75rem] text-muted-foreground";

export const labelClass = "block text-[0.875rem] font-medium text-foreground";
