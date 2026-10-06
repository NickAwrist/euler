import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { sessionLabel } from "../lib/sessionLabel";
import type { SessionSummary } from "../types";
import { Modal } from "./Modal";

export function LinkWorkspaceModal({
  sessions,
  onSelect,
  onClose,
}: {
  /** Chats whose workspace can be linked, excluding the active chat. */
  sessions: SessionSummary[];
  onSelect: (sessionId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const select = async (sessionId: string) => {
    setPendingId(sessionId);
    setError(null);
    try {
      await onSelect(sessionId);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not link workspace",
      );
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Modal
      title="Link a chat's workspace"
      subtitle="This chat will read, edit, and run commands in the other chat's files. Linked files are kept until every chat using them is deleted."
      onClose={onClose}
      closeDisabled={pendingId !== null}
      maxWidthClass="max-w-[520px]"
    >
      {error && (
        <p role="alert" className="px-3 pt-2 text-sm text-red-400">
          {error}
        </p>
      )}
      <div
        className="max-h-[min(420px,60dvh)] overflow-y-auto p-1"
        aria-label="Chats"
        aria-busy={pendingId !== null}
      >
        {sessions.length === 0 && (
          <output className="block px-3 py-3 text-sm text-muted-foreground">
            No other chats yet.
          </output>
        )}
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            disabled={pendingId !== null}
            onClick={() => void select(session.id)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-40"
          >
            <MessageSquare
              size={16}
              className="shrink-0 text-muted-foreground"
            />
            <span className="truncate">{sessionLabel(session)}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
