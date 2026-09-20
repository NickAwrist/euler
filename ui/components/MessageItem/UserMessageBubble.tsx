import { Check, Copy, Pencil, RotateCcw, Send, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { CSSProperties } from "react";
import { cx } from "../../styles";
import type { Message } from "../../types";
import { MarkdownMessage } from "../MarkdownMessage";
import { AttachmentImage } from "./AttachmentImage";
import { MessageActions } from "./MessageActions";
import { msgIconBtn, msgIconSize, msgIconStroke } from "./messageItemStyles";

type Props = {
  message: Message;
  messageIndex: number;
  animateEntry: boolean;
  enterStyle: CSSProperties | undefined;
  bubbleRef: RefObject<HTMLDivElement | null>;
  bubbleEditStyle: CSSProperties | undefined;
  isEditingUser: boolean;
  draft: string;
  setDraft: (v: string) => void;
  copied: boolean;
  isBusy: boolean;
  onCancelEditUser: () => void;
  onRequestRetryConfirm: (userIndex: number) => void;
  onRequestEditConfirm: (userIndex: number, text: string) => void;
  beginEdit: () => void;
  copyContent: () => void;
};

export function UserMessageBubble({
  message,
  messageIndex,
  animateEntry,
  enterStyle,
  bubbleRef,
  bubbleEditStyle,
  isEditingUser,
  draft,
  setDraft,
  copied,
  isBusy,
  onCancelEditUser,
  onRequestRetryConfirm,
  onRequestEditConfirm,
  beginEdit,
  copyContent,
}: Props) {
  const editRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (isEditingUser) {
      editRef.current?.focus();
    }
  }, [isEditingUser]);

  return (
    <div
      className={cx(animateEntry && "ui-animate-slide-up", "flex justify-end")}
      style={enterStyle}
    >
      <div className="group/msg flex w-full min-w-0 flex-col items-end">
        <div
          ref={bubbleRef}
          className={cx(
            "rounded-xl border border-border-subtle bg-muted px-[14px] py-2.5",
            !isEditingUser && "user-message-hold",
            "max-w-[min(85%,36rem)] min-w-0 max-[640px]:max-w-[92%]",
          )}
          style={bubbleEditStyle}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-2">
              {message.attachments
                .filter((attachment) => attachment.kind === "image")
                .map((attachment) => (
                  <AttachmentImage
                    key={attachment.id}
                    attachment={attachment}
                  />
                ))}
            </div>
          )}
          {isEditingUser ? (
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(12, Math.max(3, draft.split("\n").length))}
              className="box-border min-h-[4.5rem] w-full max-w-full bg-transparent text-[0.9375rem] leading-[1.5] text-foreground outline-none"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelEditUser();
                }
              }}
            />
          ) : (
            <MarkdownMessage className="text-foreground">
              {message.content}
            </MarkdownMessage>
          )}
        </div>
        {!isEditingUser ? (
          <div
            className={cx(
              "mt-1.5 flex max-w-[min(85%,36rem)] flex-wrap justify-end gap-1 self-end max-[640px]:max-w-[92%]",
              "message-actions opacity-0 transition-opacity duration-300 ease-out",
              "group-hover/msg:opacity-100 focus-within:opacity-100",
            )}
          >
            <MessageActions
              holdTargetRef={bubbleRef}
              actions={[
                {
                  label: "Copy message",
                  feedback: copied ? "Copied" : undefined,
                  icon: copied ? (
                    <Check size={msgIconSize} strokeWidth={msgIconStroke} />
                  ) : (
                    <Copy size={msgIconSize} strokeWidth={msgIconStroke} />
                  ),
                  onSelect: copyContent,
                },
                {
                  label: "Edit message",
                  icon: (
                    <Pencil size={msgIconSize} strokeWidth={msgIconStroke} />
                  ),
                  onSelect: beginEdit,
                  disabled: isBusy,
                },
                {
                  label: "Retry from here",
                  icon: (
                    <RotateCcw size={msgIconSize} strokeWidth={msgIconStroke} />
                  ),
                  onSelect: () => onRequestRetryConfirm(messageIndex),
                  disabled: isBusy,
                },
              ]}
            />
          </div>
        ) : (
          <div className="mt-1.5 flex max-w-[min(85%,36rem)] flex-wrap justify-end gap-1 self-end max-[640px]:max-w-[92%]">
            <button
              type="button"
              disabled={isBusy}
              onClick={onCancelEditUser}
              className={msgIconBtn}
              title="Cancel editing"
              aria-label="Cancel editing"
            >
              <X size={msgIconSize} strokeWidth={msgIconStroke} />
            </button>
            <button
              type="button"
              disabled={isBusy || !draft.trim()}
              onClick={() => onRequestEditConfirm(messageIndex, draft.trim())}
              className={msgIconBtn}
              title="Save and retry"
              aria-label="Save edits and retry; later messages will be deleted"
            >
              <Send size={msgIconSize} strokeWidth={msgIconStroke} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
