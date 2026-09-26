import { type CSSProperties, useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "../../lib/copyTextToClipboard";
import type { Message } from "../../types";
import { AssistantMessageBubble } from "./AssistantMessageBubble";
import { UserMessageBubble } from "./UserMessageBubble";
import type { MessageItemProps } from "./types";

export function MessageItem({
  message,
  messageIndex,
  animateEntry = true,
  onViewSteps,
  animDelayMs = 0,
  isBusy,
  editingUserIndex,
  onStartEditUser,
  onCancelEditUser,
  onRequestEditConfirm,
  onRegenerate,
  regenerateLabel,
}: MessageItemProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const versions = message.versions ?? [];
  // A new reply remounts this row, so viewing restarts at the latest version.
  const [versionIndex, setVersionIndex] = useState(versions.length);
  const viewed = versions[versionIndex];
  const shown: Message = viewed ? { role: message.role, ...viewed } : message;

  const isEditingUser =
    message.role === "user" && editingUserIndex === messageIndex;

  useEffect(() => {
    if (isEditingUser) setDraft(message.content);
  }, [isEditingUser, message.content]);

  const enterStyle: CSSProperties | undefined =
    animDelayMs > 0 ? { animationDelay: `${animDelayMs}ms` } : undefined;

  const copyContent = async () => {
    const ok = await copyTextToClipboard(shown.content);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const beginEdit = () => {
    onStartEditUser(messageIndex);
  };

  if (message.role === "event") {
    return (
      <div
        className="flex items-center gap-3 py-2 text-xs text-muted-foreground"
        role="note"
      >
        <span className="h-px flex-1 bg-border-subtle" />
        <span>{message.content}</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <UserMessageBubble
        message={message}
        messageIndex={messageIndex}
        animateEntry={animateEntry}
        enterStyle={enterStyle}
        bubbleRef={bubbleRef}
        isEditingUser={isEditingUser}
        draft={draft}
        setDraft={setDraft}
        copied={copied}
        isBusy={isBusy}
        onCancelEditUser={onCancelEditUser}
        onRequestEditConfirm={onRequestEditConfirm}
        beginEdit={beginEdit}
        copyContent={copyContent}
      />
    );
  }

  return (
    <AssistantMessageBubble
      message={shown}
      animateEntry={animateEntry}
      enterStyle={enterStyle}
      copied={copied}
      copyContent={copyContent}
      onViewSteps={onViewSteps}
      isBusy={isBusy}
      onRegenerate={() => onRegenerate(messageIndex)}
      regenerateLabel={regenerateLabel}
      version={
        versions.length > 0
          ? {
              index: versionIndex,
              count: versions.length + 1,
              onChange: setVersionIndex,
            }
          : undefined
      }
    />
  );
}
