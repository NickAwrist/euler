import { Bug, Download, EyeOff } from "lucide-react";
import { cx, iconButton } from "../styles";

type RunAppHeaderProps = {
  artifactsOpen?: boolean;
  activeSessionId: string | null;
  sidebarCollapsed?: boolean;
  debugOpen: boolean;
  onToggleDebug: () => void;
  onExportEntireRun?: () => void;
  isEphemeral?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Header                                                            */
/* ------------------------------------------------------------------ */

export function RunAppHeader({
  artifactsOpen,
  activeSessionId,
  sidebarCollapsed = false,
  debugOpen,
  onToggleDebug,
  onExportEntireRun,
  isEphemeral,
}: RunAppHeaderProps) {
  return (
    <div
      className={cx(
        "workspace-header pointer-events-none absolute inset-x-0 top-0 z-10 justify-between gap-3 px-4 max-[900px]:pl-14 max-[640px]:pr-3.5",
        "min-[1320px]:transition-[padding-left] min-[1320px]:duration-300 min-[1320px]:ease-[cubic-bezier(0.22,1,0.36,1)]",
        !sidebarCollapsed &&
          !artifactsOpen &&
          "min-[1320px]:pl-[calc(260px+1rem)]",
        sidebarCollapsed && "min-[901px]:pl-14",
        activeSessionId && !artifactsOpen && "pr-14 max-[640px]:pr-14",
        !activeSessionId && "border-b-0",
        activeSessionId &&
          "bg-background/[0.16] backdrop-blur-xl backdrop-saturate-125",
      )}
    >
      <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2">
        {activeSessionId && isEphemeral && (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-400">
            <EyeOff size={12} />
            Ephemeral
          </span>
        )}
      </div>
      <div className="pointer-events-auto flex shrink-0 items-center gap-1">
        {activeSessionId && onExportEntireRun && (
          <button
            type="button"
            onClick={onExportEntireRun}
            className={cx(iconButton)}
            title="Export chat as Markdown"
            aria-label="Export chat as Markdown"
          >
            <Download size={18} />
          </button>
        )}
        {activeSessionId && (
          <button
            type="button"
            onClick={onToggleDebug}
            className={cx(iconButton)}
            title={debugOpen ? "Hide debug inspector" : "Debug inspector"}
            aria-label={debugOpen ? "Hide debug inspector" : "Debug inspector"}
          >
            <Bug size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
