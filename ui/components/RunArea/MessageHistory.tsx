import { memo } from "react";
import { traceStepsForDisplay } from "../ExecutionTrace";
import { MessageItem } from "../MessageItem";
import type { MessageItemProps } from "../MessageItem/types";
import type { RunAreaProps } from "./types";

type Props = Pick<
  RunAreaProps,
  | "messages"
  | "onViewSteps"
  | "editingUserIndex"
  | "onStartEditUser"
  | "onCancelEditUser"
  | "onRequestEditConfirm"
  | "onRegenerate"
  | "regenerateLabel"
> & { initialCount: number; isBusy: boolean };

// Keep per-message closures inside the memo boundary so appending a message
// does not render all the existing rows again.
const HistoryMessage = memo(function HistoryMessage({
  onViewSteps,
  ...props
}: Omit<MessageItemProps, "onViewSteps"> & Pick<Props, "onViewSteps">) {
  const steps = props.message.steps;
  return (
    <MessageItem
      {...props}
      onViewSteps={
        steps && traceStepsForDisplay(steps).length > 0
          ? () => onViewSteps(steps)
          : undefined
      }
    />
  );
});

// Token and composer updates must not traverse or reparse saved history.
export const MessageHistory = memo(function MessageHistory({
  messages,
  initialCount,
  editingUserIndex,
  ...props
}: Props) {
  return messages.map((message, index) => (
    <HistoryMessage
      key={`${index}:${message.role}:${message.content.slice(0, 80)}`}
      {...props}
      messageIndex={index}
      message={message}
      animateEntry={index >= initialCount}
      editingUserIndex={editingUserIndex === index ? index : null}
    />
  ));
});
