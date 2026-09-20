import {
  ChartNoAxesCombined,
  EyeOff,
  Loader2,
  Plus,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { cx, iconButton } from "../../styles";
import { SessionListItem } from "./SessionListItem";
import type { SidebarProps } from "./types";

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onNewEphemeralSession,
  onRenameSession,
  onExportSession,
  onDeleteSession,
  isLoading,
  onCustomization,
  onSettings,
  onUsage,
}: SidebarProps) {
  const [openMenu, setOpenMenu] = useState<{
    id: string;
    anchorRect: DOMRect;
  } | null>(null);

  return (
    <div className="grid h-full w-[260px] min-w-[260px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-x-hidden px-2.5 pb-3">
      <div className="workspace-header -mx-2.5 mb-2.5 gap-2 pl-14 pr-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[0.9375rem] font-semibold text-foreground">
              Recent
            </span>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onNewSession}
            disabled={isLoading}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border-subtle bg-surface px-2.5 py-2 text-[0.8125rem] font-semibold text-foreground transition-[color,background-color,border-color,transform] duration-150 ease-out hover:border-border hover:bg-muted active:scale-[0.99] active:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100"
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            <span>New chat</span>
          </button>
          <button
            type="button"
            onClick={onNewEphemeralSession}
            title="Ephemeral chat - not saved"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[0.8125rem] font-semibold text-amber-400 transition-[color,background-color,border-color,transform] duration-150 ease-out hover:border-amber-500/35 hover:bg-amber-500/10 active:scale-[0.99] active:bg-amber-500/15"
          >
            <EyeOff size={16} />
          </button>
        </div>

        <div
          className="mt-1 min-h-0 overflow-x-hidden overflow-y-auto border-t border-border-subtle pt-1"
          onScroll={() => setOpenMenu(null)}
        >
          <div className="w-[calc(260px-1.25rem)] min-w-[calc(260px-1.25rem)] shrink-0">
            {sessions.map((session) => (
              <SessionListItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                onSelectSession={onSelectSession}
                onRenameSession={onRenameSession}
                onExportSession={onExportSession}
                onDeleteSession={onDeleteSession}
              />
            ))}

            {sessions.length === 0 && (
              <div className="mt-1 border-t border-border-subtle px-2.5 py-3 text-[0.8125rem] leading-[1.5] text-muted-foreground">
                No chats yet. Start one from the button above.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1 border-t border-border-subtle pt-2">
        {onUsage && (
          <button
            type="button"
            onClick={onUsage}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[0.8125rem] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChartNoAxesCombined size={15} />
            <span>Usage insights</span>
          </button>
        )}
        <button
          type="button"
          onClick={onCustomization}
          className="flex w-full items-center justify-start gap-2 rounded-lg px-2.5 py-2 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          <SlidersHorizontal size={15} className="shrink-0" />
          <span>Customization</span>
        </button>
        <button
          type="button"
          onClick={onSettings}
          className="flex w-full items-center justify-start gap-2 rounded-lg px-2.5 py-2 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          <Settings size={15} className="shrink-0" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
