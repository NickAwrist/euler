import {
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { cx, iconButton } from "../styles";

// Layout controls sit outside their sliding panels, so their positions stay fixed.
export function SidebarToggle({
  side,
  open,
  onToggle,
  className,
}: {
  side: "left" | "right";
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const Icon =
    side === "left"
      ? open
        ? PanelLeftClose
        : PanelLeft
      : open
        ? PanelRightClose
        : PanelRight;
  const name = side === "left" ? "chats" : "files";
  return (
    <button
      type="button"
      className={cx(
        iconButton,
        "absolute top-[calc((var(--workspace-header-height)-2.25rem-1px)/2)] z-50",
        side === "left" ? "left-2" : "right-2",
        open && "bg-muted text-foreground",
        className,
      )}
      aria-label={side === "left" ? "Toggle chats" : "Toggle artifacts"}
      title={`${open ? "Hide" : "Show"} ${name}`}
      aria-expanded={open}
      aria-controls={side === "left" ? "app-sidebar" : "artifact-sidebar"}
      onClick={onToggle}
    >
      <Icon size={18} />
    </button>
  );
}
