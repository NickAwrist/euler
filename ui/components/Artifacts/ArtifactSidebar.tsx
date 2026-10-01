import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../../styles";

const MIN_WIDTH = 320;
const maxWidth = () =>
  Math.max(MIN_WIDTH, Math.min(960, window.innerWidth - 600));
import {
  getUserPreferences,
  updateUserPreferences,
} from "../../persist/userPreferences";

const clampWidth = (width: number) =>
  Math.min(maxWidth(), Math.max(MIN_WIDTH, width));
const defaultWidth = () => clampWidth(Math.min(window.innerWidth * 0.42, 560));
export function initialArtifactWidth() {
  const stored = getUserPreferences().layout.artifactWidth ?? 0;
  if (stored >= MIN_WIDTH && Number.isFinite(stored)) {
    return clampWidth(stored);
  }
  return defaultWidth();
}

// The shell owns layout and dismissal. Its content supplies its own navigation.
export function ArtifactSidebar({
  children,
  open,
  onClose,
  onWidthChange,
}: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  onWidthChange: (width: number) => void;
}) {
  const [preferredWidth, setWidth] = useState(
    () => getUserPreferences().layout.artifactWidth ?? defaultWidth(),
  );
  const [availableWidth, setAvailableWidth] = useState(maxWidth);
  const width = Math.min(availableWidth, Math.max(MIN_WIDTH, preferredWidth));
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ x: number; width: number; lastWidth: number } | null>(
    null,
  );
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    // Focusing an off-screen descendant without preventScroll scrolls the
    // clipped flex container, cancelling the visible opening motion.
    if (
      !(
        previous instanceof HTMLElement &&
        previous.getAttribute("aria-controls") === "artifact-sidebar"
      )
    ) {
      panel.current?.focus({ preventScroll: true });
    }
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    const resize = () => {
      setAvailableWidth(maxWidth());
    };
    window.addEventListener("resize", resize);
    resize();
    return () => window.removeEventListener("resize", resize);
  }, []);
  const saveWidth = (value: number) => {
    void updateUserPreferences({ layout: { artifactWidth: value } }).catch(
      console.error,
    );
  };
  useEffect(() => onWidthChange(width), [width, onWidthChange]);

  useEffect(() => {
    if (!resizing) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    // The chat follows the drag directly instead of easing behind it.
    document.documentElement.setAttribute("data-window-resizing", "");
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      document.documentElement.removeAttribute("data-window-resizing");
    };
  }, [resizing]);
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      id="artifact-sidebar"
      aria-label="Artifacts"
      aria-hidden={!open}
      inert={!open}
      // Escape dismisses only while focus is in the panel, not from the chat.
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
      style={{ "--artifact-width": `${width}px` } as CSSProperties}
      className={cx(
        "absolute inset-y-0 right-0 z-20 flex outline-none w-[var(--artifact-width)] flex-col border-l border-border-subtle bg-background transition-[translate] duration-[var(--sidebar-duration)] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        "max-[900px]:z-40 max-[900px]:w-full",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
        resizing && "transition-none",
      )}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize artifact sidebar"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={availableWidth}
        aria-valuenow={Math.round(width)}
        className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none hover:bg-accent/30 focus-visible:bg-accent/30 focus-visible:outline-2 focus-visible:outline-accent-ring max-[900px]:hidden"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width, lastWidth: width };
          setResizing(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const value = clampWidth(
            drag.current.width + drag.current.x - event.clientX,
          );
          drag.current.lastWidth = value;
          setWidth(value);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          if (drag.current && drag.current.lastWidth !== drag.current.width)
            saveWidth(drag.current.lastWidth);
          drag.current = null;
          setResizing(false);
        }}
        onDoubleClick={() => {
          const value = defaultWidth();
          setWidth(value);
          saveWidth(value);
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const value =
            event.key === "Home"
              ? MIN_WIDTH
              : event.key === "End"
                ? maxWidth()
                : clampWidth(width + (event.key === "ArrowLeft" ? 16 : -16));
          setWidth(value);
          saveWidth(value);
        }}
      />
      {children}
    </aside>
  );
}
