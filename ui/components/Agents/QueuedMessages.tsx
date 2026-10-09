import { useState } from "react";
import type { InboxMessage } from "../../../src/schemas/agents";
import { whileRunning } from "../../lib/whileRunning";
import {
  agentAction,
  editQueuedMessage,
  removeQueuedMessage,
} from "../../persist/agents";
import { Button } from "../Button";
export function QueuedMessages({
  sessionId,
  messages,
  held,
  refresh,
}: {
  sessionId: string;
  messages: InboxMessage[];
  held: boolean;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const act = (action: () => Promise<void>) =>
    whileRunning(setPending, async () => {
      setError("");
      try {
        await action();
        await refresh();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not update queued messages",
        );
      }
    });
  return (
    <div className="space-y-2">
      {messages.map((message) => (
        <div
          key={message.id}
          className="flex items-center justify-between gap-2 rounded-lg bg-muted p-2 text-sm"
        >
          {editing === message.id ? (
            <>
              <textarea
                aria-label="Edit queued message"
                className="min-w-0 flex-1 rounded bg-background p-2"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={pending || !draft.trim()}
                onClick={() =>
                  void act(async () => {
                    await editQueuedMessage(sessionId, message.id, draft);
                    setEditing(null);
                  })
                }
              >
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate">
                Queued: {message.content}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setDraft(message.content);
                  setEditing(message.id);
                }}
              >
                Edit
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              void act(() => removeQueuedMessage(sessionId, message.id))
            }
          >
            Remove
          </Button>
        </div>
      ))}
      {held && (
        <div className="flex items-center justify-between rounded-lg bg-muted p-2 text-sm">
          Agent updates waiting
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => void act(() => agentAction(sessionId, "deliver"))}
          >
            Deliver
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
