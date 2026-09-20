export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const eyebrowText =
  "text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground";

export const primaryButton =
  "inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[0.8125rem] font-semibold text-accent-foreground transition-[color,background-color,transform,filter] duration-150 ease-out hover:bg-accent-hover active:scale-[0.985] active:brightness-[0.94] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100";

export const secondaryButton =
  "inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-transparent px-3 py-2 text-[0.8125rem] text-foreground transition-[color,background-color,border-color,transform] duration-150 ease-out hover:border-border hover:bg-muted active:scale-[0.99] active:bg-muted/80";

export const iconButton =
  "inline-flex size-9 items-center justify-center rounded-lg border border-border-subtle bg-transparent text-muted-foreground transition-[color,background-color,border-color,transform] duration-150 ease-out hover:border-border hover:bg-muted hover:text-foreground active:scale-[0.96] active:bg-muted/70";

export const modalShell =
  "fixed inset-0 z-50 m-0 flex h-screen max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/55 p-4 text-foreground backdrop-blur-[8px] sm:p-[10px] ui-animate-modal-shell";

export const modalSurface =
  "grid max-h-[calc(100vh-32px)] grid-rows-[auto_minmax(0,1fr)] rounded-xl border border-border-subtle bg-surface ui-animate-modal-panel";

export const modalHeader =
  "flex items-center justify-between gap-3 border-b border-border-subtle px-[18px] py-[14px] sm:px-3.5 sm:py-3.5";

export const modalCloseButton =
  "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.94] active:bg-muted/80";

export const debugBlock =
  "rounded-lg border border-border-subtle bg-background px-[14px] py-3 text-[0.8125rem] leading-[1.6] text-foreground";

export const inputClass =
  "flex h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[0.875rem] text-foreground placeholder:text-muted-foreground transition-colors focus:border-border focus:outline-none";

export const selectClass =
  "flex h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[0.875rem] text-foreground transition-colors focus:border-border focus:outline-none";

export const textareaClass =
  "flex w-full rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-[0.875rem] leading-[1.6] text-foreground placeholder:text-muted-foreground transition-colors focus:border-border focus:outline-none";

export const hintClass = "text-[0.75rem] text-muted-foreground";

export const labelClass = "block text-[0.875rem] font-medium text-foreground";
