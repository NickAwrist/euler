import { X } from "lucide-react";
import type {
  ComponentType,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
} from "react";
import { useEffect, useId, useRef } from "react";
import {
  cx,
  eyebrowText,
  modalCloseButton,
  modalHeader,
  modalShell,
  modalSurface,
} from "../styles";

export interface ModalProps {
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ComponentType<{ size?: number; className?: string }>;
  headerActions?: ReactNode;
  closeLabel?: string;
  hideCloseButton?: boolean;
  closeDisabled?: boolean;
  busy?: boolean;
  maxWidthClass?: string;
  surfaceClassName?: string;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLDialogElement>) => void;
  children: ReactNode;
}

export function Modal({
  onClose,
  title,
  subtitle,
  eyebrow,
  icon: Icon,
  headerActions,
  closeLabel = "Close",
  hideCloseButton = false,
  closeDisabled = false,
  busy = false,
  maxWidthClass = "max-w-[400px]",
  surfaceClassName,
  className,
  ariaLabel,
  ariaLabelledBy,
  initialFocusRef,
  onKeyDown,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const generatedTitleId = useId();
  const effectiveTitleId =
    ariaLabelledBy ?? (title ? generatedTitleId : undefined);
  const isDismissDisabled = closeDisabled || busy;

  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    }

    if (initialFocusRef?.current) {
      initialFocusRef.current.focus();
    }

    return () => {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus();
      }
    };
  }, [initialFocusRef]);

  const handleClose = () => {
    if (isDismissDisabled) return;
    onClose();
  };

  const handleDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  };

  const handleCancel = (
    event: React.SyntheticEvent<HTMLDialogElement, Event>,
  ) => {
    event.preventDefault();
    handleClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      handleClose();
    }
    onKeyDown?.(event);
  };

  const showHeader = Boolean(
    title || eyebrow || subtitle || Icon || headerActions || !hideCloseButton,
  );

  return (
    <dialog
      ref={dialogRef}
      className={cx(modalShell, className)}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : effectiveTitleId}
      onClick={handleDialogClick}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
    >
      <div className={cx("relative w-full", maxWidthClass)}>
        <div className={cx(modalSurface, surfaceClassName)}>
          {showHeader && (
            <div className={modalHeader}>
              <div>
                {eyebrow && <div className={eyebrowText}>{eyebrow}</div>}
                {title && (
                  <h2
                    id={effectiveTitleId}
                    className="mt-1 flex items-center gap-2 text-[1.0625rem] font-semibold tracking-[-0.02em]"
                  >
                    {Icon && <Icon size={18} className="shrink-0" />}
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {headerActions}
                {!hideCloseButton && (
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={isDismissDisabled}
                    aria-label={closeLabel}
                    className={cx(
                      modalCloseButton,
                      isDismissDisabled && "pointer-events-none opacity-40",
                    )}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            </div>
          )}
          {children}
        </div>
      </div>
    </dialog>
  );
}
