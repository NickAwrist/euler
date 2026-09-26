import { cx } from "../styles";

type SidebarBackdropProps = {
  open: boolean;
  onClose: () => void;
};

export function SidebarBackdrop({ open, onClose }: SidebarBackdropProps) {
  return (
    <button
      type="button"
      aria-hidden={!open}
      tabIndex={open ? 0 : -1}
      className={cx(
        "fixed inset-0 z-20 border-0 bg-black/45 transition-opacity duration-[var(--sidebar-duration)] ease-out max-[900px]:block min-[901px]:hidden",
        open
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0",
      )}
      onClick={onClose}
      aria-label="Close sidebar"
    />
  );
}
