import {
  type Range,
  defaultRangeExtractor,
  useVirtualizer,
} from "@tanstack/react-virtual";
import {
  type RefObject,
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AgentRows } from "../Agents/AgentTaskCard";
import { traceStepsForDisplay } from "../ExecutionTrace";
import { JobRows } from "../Jobs/JobTaskCard";
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
> & {
  initialCount: number;
  isBusy: boolean;
  scrollRef: RefObject<HTMLElement | null>;
};

// Keep per-message closures and rows inside the memo boundary so appending a
// message or moving the virtual window does not render existing rows again.
const HistoryMessage = memo(function HistoryMessage({
  onViewSteps,
  ...props
}: Omit<MessageItemProps, "onViewSteps"> & Pick<Props, "onViewSteps">) {
  const steps = props.message.steps;
  return (
    <>
      <MessageItem
        {...props}
        onViewSteps={
          steps && traceStepsForDisplay(steps).length > 0
            ? () => onViewSteps(steps)
            : undefined
        }
      />
      <AgentRows position={props.messageIndex} />
      <JobRows position={props.messageIndex} />
    </>
  );
});

/** Rough height of an unmeasured message, corrected once it renders. */
const ESTIMATED_MESSAGE_HEIGHT = 240;

// Token and composer updates must not traverse or reparse saved history, and
// long chats mount only the messages near the viewport.
export const MessageHistory = memo(function MessageHistory({
  messages,
  initialCount,
  editingUserIndex,
  scrollRef,
  ...props
}: Props) {
  "use no memo"; // React Compiler cannot memoize around the mutable virtualizer.
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    setScrollMargin(listRef.current?.offsetTop ?? 0);
  });
  // A stable key function lets the virtualizer reuse its measurements on scroll.
  const getItemKey = useCallback(
    (index: number) => {
      const message = messages[index];
      return message
        ? `${index}:${message.role}:${message.content.slice(0, 80)}`
        : index;
    },
    [messages],
  );
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    getItemKey,
    // An open editor stays mounted so scrolling away keeps its draft.
    rangeExtractor: (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      return editingUserIndex === null || indexes.includes(editingUserIndex)
        ? indexes
        : [...indexes, editingUserIndex].sort((a, b) => a - b);
    },
    scrollMargin,
    overscan: 4,
    useFlushSync: false,
    // Scrolling repositions rows in the DOM and re-renders only when the
    // mounted range changes.
    directDomUpdates: true,
    // Measuring inside the ResizeObserver callback resizes observed content
    // again and trips the browser's ResizeObserver loop error.
    useAnimationFrameWithResizeObserver: true,
  });
  const setList = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      virtualizer.containerRef(node);
    },
    [virtualizer],
  );

  return (
    <div ref={setList} className="relative w-full">
      {virtualizer.getVirtualItems().map((item) => {
        const message = messages[item.index];
        if (!message) return null;
        return (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            className="absolute top-0 left-0 flex w-full flex-col"
          >
            <HistoryMessage
              {...props}
              messageIndex={item.index}
              message={message}
              animateEntry={item.index >= initialCount}
              editingUserIndex={
                editingUserIndex === item.index ? item.index : null
              }
            />
          </div>
        );
      })}
    </div>
  );
});
