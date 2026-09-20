import { Bot } from "lucide-react";
import { memo, useLayoutEffect, useRef } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import { MarkdownMessage } from "../MarkdownMessage";
import { MessageHistory } from "./MessageHistory";
import { StreamingStatusRow } from "./StreamingStatusRow";
import type { RunAreaProps } from "./types";

export const RunArea = memo(function RunArea({
  messages,
  sessionLoadState,
  sessionError,
  sessionSendReady,
  onRetryLoad,
  streamingSteps,
  streamingStep,
  streamingContent,
  streamingThinking,
  runPending,
  footerInset,
  onViewSteps,
  editingUserIndex,
  onStartEditUser,
  onCancelEditUser,
  onRequestEditConfirm,
  onRequestRetryConfirm,
}: RunAreaProps) {
  const { scrollRef, contentRef, scrollToBottom, isAtBottom } =
    useStickToBottom({
      initial: "instant",
    });
  const isBusy =
    !sessionSendReady ||
    runPending ||
    streamingStep !== null ||
    streamingSteps.length > 0;
  const initialRenderedCountRef = useRef<number | null>(null);

  if (initialRenderedCountRef.current === null && messages.length > 0) {
    initialRenderedCountRef.current = messages.length;
  }

  useLayoutEffect(() => {
    if (messages.length === 0) return;
    const scrollElement = scrollRef.current;
    if (scrollElement && scrollElement.scrollTop === 0) {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }
  }, [messages.length, scrollRef]);

  useLayoutEffect(() => {
    if (isAtBottom) {
      void scrollToBottom({
        animation: "instant",
        preserveScrollPosition: true,
      });
    }
  }, [footerInset, isAtBottom, scrollToBottom]);

  const initialCount = initialRenderedCountRef.current ?? 0;

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-x-hidden">
      <div
        ref={scrollRef}
        className="absolute inset-0 z-0 overflow-x-hidden overflow-y-auto px-5 pt-[calc(var(--workspace-header-height)+1.25rem)] max-[640px]:px-3.5 max-[640px]:pt-[calc(var(--workspace-header-height)+1rem)]"
        style={{ paddingBottom: footerInset + 12 }}
      >
        <div
          ref={contentRef}
          className="mx-auto flex min-h-min w-full max-w-3xl flex-col"
        >
          {sessionError && (
            <div
              className="py-4 text-sm text-muted-foreground"
              aria-live="polite"
            >
              <p>{sessionError}</p>
              <button
                type="button"
                onClick={onRetryLoad}
                className="mt-2 underline"
              >
                Retry
              </button>
            </div>
          )}
          {sessionLoadState === "loading" && messages.length === 0 && (
            <p
              className="py-8 text-sm text-muted-foreground"
              aria-live="polite"
            >
              Loading conversation…
            </p>
          )}
          {sessionLoadState === "empty" && messages.length === 0 && !isBusy && (
            <div className="flex items-center gap-2 bg-transparent py-8 text-[0.875rem] text-muted-foreground">
              <Bot size={14} />
              <p>Start the session with a message below.</p>
            </div>
          )}

          <MessageHistory
            messages={messages}
            initialCount={initialCount}
            onViewSteps={onViewSteps}
            isBusy={isBusy}
            editingUserIndex={editingUserIndex}
            onStartEditUser={onStartEditUser}
            onCancelEditUser={onCancelEditUser}
            onRequestEditConfirm={onRequestEditConfirm}
            onRequestRetryConfirm={onRequestRetryConfirm}
          />

          {(streamingStep || streamingSteps.length > 0) && (
            <StreamingStatusRow
              streamingStep={streamingStep}
              streamingSteps={streamingSteps}
              streamingContent={streamingContent}
              streamingThinking={streamingThinking}
              onViewSteps={onViewSteps}
            />
          )}

          {streamingContent && (
            <div className="ui-animate-slide-up flex w-full min-w-0 flex-col">
              <div className="max-w-[min(100%,42rem)] min-w-0 pt-4 max-[640px]:pt-3.5">
                <MarkdownMessage className="text-foreground">
                  {streamingContent}
                </MarkdownMessage>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
