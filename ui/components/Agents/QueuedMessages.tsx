import { type Dispatch, type SetStateAction, useState } from "react";
import type { InboxMessage } from "../../../src/gen/euler/v1/agent_pb";
import { whileRunning } from "../../lib/whileRunning";
import { deliverQueued, removeQueuedMessage } from "../../persist/agents";
import { Button } from "../Button";
export function QueuedMessages({
  sessionId,
  messages,
  held,
  refresh,
  setInput,
}: {
  sessionId: string;
  messages: InboxMessage[];
  held: boolean;
  refresh: () => Promise<void>;
  setInput: Dispatch<SetStateAction<string>>;
}) {
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
          key={String(message.id)}
          className="flex items-center justify-between gap-2 rounded-lg bg-muted p-2 text-sm"
        >
          <span className="min-w-0 flex-1 truncate">
            Queued: {message.content}
          </span>
          {/* The composer cannot restore uploaded images, so those messages can only be removed. */}
          {message.attachmentIds.length === 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                void act(async () => {
                  await removeQueuedMessage(sessionId, message.id);
                  setInput((draft) =>
                    draft ? `${message.content}\n${draft}` : message.content,
                  );
                })
              }
            >
              Edit
            </Button>
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
            onClick={() => void act(() => deliverQueued(sessionId))}
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
