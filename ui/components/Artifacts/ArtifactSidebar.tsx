import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../../styles";

const WIDTH_KEY = "euler:artifactSidebarWidth";
const MIN_WIDTH = 320;
const maxWidth = () =>
  Math.max(MIN_WIDTH, Math.min(960, window.innerWidth - 600));
import { safeStorage } from "../../lib/safeStorage";

const clampWidth = (width: number) =>
  Math.min(maxWidth(), Math.max(MIN_WIDTH, width));
const defaultWidth = () => clampWidth(Math.min(window.innerWidth * 0.42, 560));
function initialWidth() {
  const stored = Number(safeStorage.getItem(WIDTH_KEY));
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
}: { children: ReactNode; open: boolean; onClose: () => void }) {
  const [width, setWidth] = useState(initialWidth);
  const [availableWidth, setAvailableWidth] = useState(maxWidth);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ x: number; width: number } | null>(null);
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
      setWidth((value) => clampWidth(value));
      setAvailableWidth(maxWidth());
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (resizing) return;
    safeStorage.setItem(WIDTH_KEY, String(width));
  }, [width, resizing]);

  useEffect(() => {
    if (!resizing) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
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
        "relative z-20 flex h-full outline-none w-[var(--artifact-width)] shrink-0 flex-col border-l border-border-subtle bg-background transition-[margin-right,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        "max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-40 max-[900px]:mr-0 max-[900px]:w-full",
        open
          ? "mr-0 max-[900px]:translate-x-0"
          : "pointer-events-none mr-[calc(-1*var(--artifact-width))] max-[900px]:translate-x-full",
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
          drag.current = { x: event.clientX, width };
          setResizing(true);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setWidth(
              clampWidth(drag.current.width + drag.current.x - event.clientX),
            );
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          setResizing(false);
        }}
        onDoubleClick={() => setWidth(defaultWidth())}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          setWidth((value) =>
            event.key === "Home"
              ? MIN_WIDTH
              : event.key === "End"
                ? maxWidth()
                : clampWidth(value + (event.key === "ArrowLeft" ? 16 : -16)),
          );
        }}
      />
      {children}
    </aside>
  );
}
