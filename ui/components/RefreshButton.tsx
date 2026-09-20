import { RefreshCw } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

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
  if (iconOnly) {
    return (
      <IconButton
        label={label}
        icon={RefreshCw}
        iconSize={15}
        loading={refreshing}
        disabled={disabled}
        onClick={onClick}
      />
    );
  }

  return (
    <Button
      variant="secondary"
      icon={RefreshCw}
      loading={refreshing}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
