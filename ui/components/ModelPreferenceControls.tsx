import { Star, X } from "lucide-react";
import { useEffect } from "react";
import { cx } from "../styles";

export function FavoriteButton({
  favorite,
  name,
  disabled,
  onClick,
}: {
  favorite: boolean;
  name: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${name}`}
      aria-pressed={favorite}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent-ring disabled:cursor-wait motion-reduce:transition-none",
        favorite
          ? "text-[#c6ad65]"
          : "text-muted-foreground hover:text-[#c6ad65]",
      )}
    >
      <Star
        size={18}
        className={cx(
          "transition-[fill,transform] duration-200 motion-reduce:transition-none",
          favorite ? "scale-110 fill-current" : "scale-100 fill-transparent",
        )}
      />
    </button>
  );
}
export function EnableSwitch({
  id,
  checked,
  label,
  disabled,
  onChange,
}: {
  id?: string;
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full border transition-[background-color,border-color,opacity] duration-200 focus-visible:outline-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed motion-reduce:transition-none",
        checked
          ? "border-foreground/30 bg-foreground/70"
          : "border-border bg-muted",
      )}
    >
      <span
        className={cx(
          "absolute left-0.5 top-0.5 size-3.5 rounded-full shadow-sm transition-[transform,background-color] duration-200 motion-reduce:transition-none",
          checked
            ? "translate-x-4 bg-background"
            : "translate-x-0 bg-muted-foreground",
        )}
      />
    </button>
  );
}
export function PreferenceNotice({
  message,
  onDismiss,
}: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <div
      role="alert"
      className="absolute inset-x-4 bottom-4 z-10 flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-xl ui-animate-modal-panel"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function NewBadge({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "shrink-0 rounded border border-[#c6ad65]/25 bg-background px-1.5 py-0.5 font-medium leading-none text-[#c6ad65]",
        "text-[10px]",
        className,
      )}
    >
      New
    </span>
  );
}
