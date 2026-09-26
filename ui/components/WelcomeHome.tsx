import { EyeOff, Sparkles } from "lucide-react";
import type { SessionSummary } from "../types";

type WelcomeHomeProps = {
  sessions: SessionSummary[];
  /** Home, unlike an empty chat, also offers ephemeral and recent chats. */
  home: boolean;
  ephemeral: boolean;
  /** Height of the centered composer this screen is laid out around. */
  composerHeight: number;
  onNewEphemeralRun: () => void;
  onOpenSession: (id: string) => void;
};

export function WelcomeHome({
  sessions,
  home,
  ephemeral,
  composerHeight,
  onNewEphemeralRun,
  onOpenSession,
}: WelcomeHomeProps) {
  const composerHalf = `${composerHeight / 2}px`;
  return (
    <div className="ui-animate-fade-in relative h-full w-full">
      <div
        className="absolute inset-x-0 flex flex-col items-center px-6 text-center"
        style={{ bottom: `calc(50% + ${composerHalf} + 0.5rem)` }}
      >
        <div
          className="mb-4 flex size-[44px] items-center justify-center rounded-[12px] bg-accent-soft text-accent"
          aria-hidden
        >
          {ephemeral ? <EyeOff size={20} /> : <Sparkles size={20} />}
        </div>
        <h2 className="mb-2 text-[1.375rem] font-semibold leading-[1.25] tracking-[-0.02em] text-foreground">
          {ephemeral
            ? "Ephemeral chat"
            : sessions.length > 0
              ? "What are we working on?"
              : "Start your first chat"}
        </h2>
        <p className="m-0 max-w-[40ch] text-[0.9375rem] leading-[1.6] text-muted-foreground">
          {ephemeral
            ? "Nothing here is saved. Messages and files are deleted when you leave."
            : "Type / for commands or $ to use a skill."}
        </p>
      </div>
      {home && (
        <div
          className="absolute inset-x-0 bottom-0 overflow-y-auto px-6 pb-6"
          style={{ top: `calc(50% + ${composerHalf} + 0.25rem)` }}
        >
          <div className="mx-auto flex w-full max-w-[28rem] flex-col items-center gap-6">
            <button
              type="button"
              onClick={onNewEphemeralRun}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-1.5 text-[0.75rem] font-semibold text-amber-400 transition-[color,background-color,border-color,transform] duration-150 ease-out hover:border-amber-500/40 hover:bg-amber-500/10 active:scale-[0.98] active:bg-amber-500/15"
            >
              <EyeOff size={14} />
              Start an ephemeral chat
            </button>
            {sessions.length > 0 && (
              <div className="w-full border-t border-border-subtle pt-2">
                <div className="mb-2.5 text-center text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Recent
                </div>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {sessions.slice(0, 5).map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-left text-[0.8125rem] transition-[color,background-color,border-color,transform] duration-150 ease-out hover:border-border hover:bg-muted active:scale-[0.99] active:bg-muted/80"
                        onClick={() => onOpenSession(s.id)}
                      >
                        <span className="min-w-0 truncate whitespace-nowrap font-medium text-foreground">
                          {s.preview || "Chat"}
                        </span>
                        <span className="shrink-0 text-[0.75rem] text-muted-foreground">
                          {new Date(s.updatedAt).toLocaleDateString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
