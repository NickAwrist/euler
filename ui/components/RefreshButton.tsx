import { RefreshCw } from "lucide-react";
import { cx, iconButton, secondaryButton } from "../styles";

export function RefreshButton({
  label,
  refreshing,
  disabled = false,
  iconOnly = false,
  onClick,
}: {
  label: string;
  refreshing: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(
        iconOnly ? iconButton : secondaryButton,
        "disabled:pointer-events-none disabled:opacity-45",
      )}
      disabled={disabled || refreshing}
      aria-busy={refreshing}
      aria-label={label}
      title={iconOnly ? label : undefined}
      onClick={onClick}
    >
      <RefreshCw
        size={15}
        className={
          refreshing ? "animate-spin motion-reduce:animate-none" : undefined
        }
      />
      {!iconOnly && label}
    </button>
  );
}
