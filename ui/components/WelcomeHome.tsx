import { EyeOff, MessageSquarePlus, Sparkles } from "lucide-react";
import type { SessionSummary } from "../types";
import { Button } from "./Button";

type WelcomeHomeProps = {
  sessions: SessionSummary[];
  isLoading: boolean;
  onNewRun: () => void;
  onNewEphemeralRun: () => void;
  onOpenSession: (id: string) => void;
};

export function WelcomeHome({
  sessions,
  isLoading,
  onNewRun,
  onNewEphemeralRun,
  onOpenSession,
}: WelcomeHomeProps) {
  return (
    <div className="ui-animate-fade-in mx-auto flex h-full w-full max-w-[28rem] flex-col items-center justify-center gap-8 px-6 pb-12 pt-8">
      <div className="flex flex-col items-center text-center">
        <div
          className="mb-5 flex size-[52px] items-center justify-center rounded-[14px] bg-accent-soft text-accent"
          aria-hidden
        >
          <Sparkles size={22} />
        </div>
        <h2 className="mb-2.5 text-[1.375rem] font-semibold leading-[1.25] tracking-[-0.02em] text-foreground">
          Pick a chat or start fresh
        </h2>
        <p className="m-0 max-w-[34ch] text-[0.9375rem] leading-[1.65] text-muted-foreground">
          Your conversations live in the sidebar. Open one to continue, or
          create a new thread for a clean chat.
        </p>
        <div className="mt-[22px] flex items-center gap-2.5">
          <Button
            variant="primary"
            onClick={onNewRun}
            disabled={isLoading}
            icon={MessageSquarePlus}
          >
            New chat
          </Button>
          <button
            type="button"
            onClick={onNewEphemeralRun}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-[0.8125rem] font-semibold text-amber-400 transition-[color,background-color,border-color,transform] duration-150 ease-out hover:border-amber-500/40 hover:bg-amber-500/10 active:scale-[0.98] active:bg-amber-500/15"
          >
            <EyeOff size={16} />
            Ephemeral
          </button>
        </div>
      </div>
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
  );
}
