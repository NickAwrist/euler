import { Download, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { cx } from "../../styles";
import type { SessionSummary } from "../../types";
import { FloatingOptionsMenu } from "../FloatingOptionsMenu";
import { formatSessionTime } from "./sessionDates";

type Props = {
  session: SessionSummary;
  now: number;
  active: boolean;
  openMenu: { id: string; anchorRect: DOMRect } | null;
  setOpenMenu: (menu: { id: string; anchorRect: DOMRect } | null) => void;
  onSelectSession: (id: string) => void;
  onExportSession: (id: string) => Promise<void>;
  onRenameSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
};

export function SessionListItem({
  session,
  now,
  active,
  openMenu,
  setOpenMenu,
  onSelectSession,
  onRenameSession,
  onExportSession,
  onDeleteSession,
}: Props) {
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const menuOpen = openMenu?.id === session.id;

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_32px] items-stretch border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={() => {
          setOpenMenu(null);
          onSelectSession(session.id);
        }}
        className={cx(
          "relative block w-full rounded-none border-l-2 border-transparent bg-transparent px-2 py-2 pr-1 text-left transition-[color,background-color,border-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.995]",
          active && "border-l-foreground/35 bg-muted/20 hover:bg-muted/35",
        )}
      >
        <div className="min-w-0">
          <div className="overflow-hidden text-[0.8125rem] leading-[1.35] text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
            {session.preview || "New chat"}
          </div>
          <time
            dateTime={new Date(session.updatedAt).toISOString()}
            title={new Date(session.updatedAt).toLocaleString()}
            className="mt-0.5 block text-[0.6875rem] text-muted-foreground"
          >
            {formatSessionTime(session.updatedAt, now)}
          </time>
        </div>
      </button>
      <div className="relative flex items-start justify-center pr-0.5 pt-1.5">
        <button
          type="button"
          className={cx(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.94] active:bg-muted/70",
            // Pointer devices reveal the menu on row hover or focus; touch devices always show it.
            menuOpen
              ? "bg-muted text-foreground"
              : "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
          )}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="Chat options"
          onClick={(e) => {
            e.stopPropagation();
            if (menuOpen) {
              setOpenMenu(null);
              return;
            }
            setOpenMenu({
              id: session.id,
              anchorRect: e.currentTarget.getBoundingClientRect(),
            });
          }}
        >
          <MoreVertical size={16} />
        </button>
        {menuOpen && (
          <FloatingOptionsMenu
            anchorRect={openMenu.anchorRect}
            onClose={() => setOpenMenu(null)}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[0.8125rem] text-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.99] active:bg-muted/80"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onRenameSession(session.id);
              }}
            >
              <Pencil size={14} />
              Rename
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[0.8125rem] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
              role="menuitem"
              disabled={exporting}
              onClick={async () => {
                setExportError("");
                setExporting(true);
                try {
                  await onExportSession(session.id);
                  setOpenMenu(null);
                } catch (error) {
                  setExportError(
                    error instanceof Error
                      ? error.message
                      : "Could not export chat.",
                  );
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download size={14} />
              {exporting ? "Exporting..." : "Export"}
            </button>
            {exportError && (
              <p role="alert" className="px-2.5 py-2 text-xs text-red-400">
                {exportError}
              </p>
            )}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[0.8125rem] text-red-400 transition-[color,background-color,transform] duration-150 ease-out hover:bg-red-400/10 hover:text-red-300 active:scale-[0.99] active:bg-red-400/15"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onDeleteSession(session.id);
              }}
            >
              <Trash2 size={14} />
              Delete
            </button>
          </FloatingOptionsMenu>
        )}
      </div>
    </div>
  );
}
