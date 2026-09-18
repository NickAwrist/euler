import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../styles";

export interface AnchoredPopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  popoverTarget: string;
  isOpen: boolean;
  open: () => void;
  close: (restoreFocus?: boolean) => void;
}

export interface AnchoredPopoverPanelHelpers {
  close: (restoreFocus?: boolean) => void;
  open: () => void;
  isOpen: boolean;
  panelRef: RefObject<HTMLDialogElement | null>;
}

export interface AnchoredPopoverProps {
  /** Optional custom ID for popover target wiring; auto-generated if omitted. */
  id?: string;
  /** Disables the trigger and closes the panel if currently open. */
  disabled?: boolean;
  /** Accessible label for the popover dialog element. */
  ariaLabel: string;
  /** Additional CSS classes for the outer trigger container. */
  containerClassName?: string;
  /** Additional CSS classes for the popover dialog panel. */
  panelClassName?: string;
  /** Maximum panel height in pixels. Defaults to 280. */
  maxHeight?: number;
  /** Gap in pixels between the trigger button and the popover. Defaults to 6. */
  gap?: number;
  /** Callback fired whenever the popover opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Callback fired when the popover opens, with a reference to the panel element. */
  onOpen?: (panel: HTMLDialogElement) => void;
  /** Additional keydown handler for the popover dialog panel. */
  onPanelKeyDown?: (event: KeyboardEvent<HTMLDialogElement>) => void;
  /** Render function for the trigger button. */
  renderTrigger: (props: AnchoredPopoverTriggerProps) => ReactNode;
  /** Children rendered inside the popover dialog, or a render function receiving helper actions. */
  children?: ReactNode | ((helpers: AnchoredPopoverPanelHelpers) => ReactNode);
}

export function AnchoredPopover({
  id,
  disabled,
  ariaLabel,
  containerClassName,
  panelClassName,
  maxHeight = 280,
  gap = 6,
  onOpenChange,
  onOpen,
  onPanelKeyDown,
  renderTrigger,
  children,
}: AnchoredPopoverProps) {
  const generatedId = useId();
  const menuId = id ?? generatedId;
  const panelRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback((restoreFocus = true) => {
    panelRef.current?.hidePopover();
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const openPanel = useCallback(() => {
    panelRef.current?.showPopover();
  }, []);

  useEffect(() => {
    if (disabled && open) {
      panelRef.current?.hidePopover();
    }
  }, [disabled, open]);

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const wasOpenRef = useRef(false);

  useLayoutEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;

    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 8;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const right = left + (viewport?.width ?? window.innerWidth) - 16;
      const bottom = top + (viewport?.height ?? window.innerHeight) - 16;

      const spaceAbove = rect.top - top;
      const spaceBelow = bottom - rect.bottom;
      const openUpwards =
        spaceAbove >= panel.offsetHeight + gap || spaceAbove >= spaceBelow;

      const availableHeight = openUpwards
        ? Math.max(0, spaceAbove - gap)
        : Math.max(0, spaceBelow - gap);

      panel.style.maxHeight = `${Math.min(maxHeight, availableHeight)}px`;
      panel.style.left = `${Math.max(left, Math.min(rect.left, right - panel.offsetWidth))}px`;
      panel.style.top = openUpwards
        ? `${Math.max(top, rect.top - panel.offsetHeight - gap)}px`
        : `${Math.min(bottom - panel.offsetHeight, rect.bottom + gap)}px`;
    };

    position();
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      onOpenRef.current?.(panel);
    }

    const observer = new ResizeObserver(position);
    observer.observe(panel);
    const scrollOptions: AddEventListenerOptions = {
      passive: true,
      capture: true,
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, scrollOptions);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position, {
      passive: true,
    });

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, scrollOptions);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open, gap, maxHeight]);

  const panelHelpers: AnchoredPopoverPanelHelpers = {
    close,
    open: openPanel,
    isOpen: open,
    panelRef,
  };

  return (
    <div className={cx("relative shrink-0", containerClassName)}>
      {renderTrigger({
        ref: triggerRef,
        popoverTarget: menuId,
        isOpen: open,
        open: openPanel,
        close,
      })}
      {/*
        Using <dialog popover="auto"> preserves the established accessible role="dialog"
        expected by assistive tech and browser test selectors for model picking,
        while leveraging the native Top Layer Popover API for light-dismiss and stacking.
      */}
      <dialog
        ref={panelRef}
        id={menuId}
        popover="auto"
        aria-label={ariaLabel}
        className={cx(
          "anchored-popover outline-none focus:outline-none",
          panelClassName,
        )}
        onToggle={(event) => {
          // React 19 typing for ToggleEvent does not yet expose `newState` on HTMLDialogElement.
          const isOpen = (event.newState as string) === "open";
          setOpen(isOpen);
          onOpenChange?.(isOpen);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            panelRef.current?.hidePopover();
            triggerRef.current?.focus();
            return;
          }
          onPanelKeyDown?.(event);
        }}
      >
        {typeof children === "function" ? children(panelHelpers) : children}
      </dialog>
    </div>
  );
}
