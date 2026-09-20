import { Check, Copy, Download, Waypoints } from "lucide-react";
import type { CSSProperties } from "react";
import type { WorkspaceFileAttachment } from "../../../src/attachments/types";
import { cx } from "../../styles";
import type { Message } from "../../types";
import { useArtifacts } from "../Artifacts/ArtifactContext";
import { FileIcon } from "../Artifacts/FileIcon";
import { traceStepsForDisplay } from "../ExecutionTrace";
import { MarkdownMessage, extractComfyUIImageUrls } from "../MarkdownMessage";
import { MessageMoreActions } from "./MessageMoreActions";
import { msgIconBtn, msgIconSize, msgIconStroke } from "./messageItemStyles";

type Props = {
  message: Message;
  animateEntry: boolean;
  enterStyle: CSSProperties | undefined;
  copied: boolean;
  copyContent: () => void;
  onViewSteps?: () => void;
};

export function AssistantMessageBubble({
  message,
  animateEntry,
  enterStyle,
  copied,
  copyContent,
  onViewSteps,
}: Props) {
  const artifacts = useArtifacts();
  const comfyImageUrls = extractComfyUIImageUrls(message.content);
  const outputFiles =
    message.attachments?.filter(
      (attachment): attachment is WorkspaceFileAttachment =>
        attachment.kind === "file",
    ) ?? [];
  return (
    <div
      className={cx(
        "group/msg flex w-full min-w-0 flex-col",
        animateEntry && "ui-animate-slide-up",
      )}
      style={enterStyle}
    >
      <div
        className="flex w-full justify-start pt-4 max-[640px]:pt-3.5"
        aria-hidden
      >
        <div className="h-px w-9 max-[640px]:w-8 shrink-0 rounded-full bg-border-subtle/70" />
      </div>
      <div className="max-w-[min(100%,42rem)] min-w-0 pt-2">
        <div className="-mx-2 rounded-lg px-2">
          <MarkdownMessage className="text-foreground">
            {message.content}
          </MarkdownMessage>
          {outputFiles.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              {outputFiles.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => artifacts?.openFile(file.path)}
                  disabled={!artifacts}
                  aria-label={`Preview ${file.name}`}
                  title={`Preview ${file.path}`}
                  className="flex w-fit max-w-full self-start items-center gap-2 rounded-lg border border-border-subtle bg-muted/40 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                >
                  <FileIcon path={file.path} />
                  <span className="min-w-0 truncate">{file.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className={cx(
            "mt-2 flex flex-wrap items-center gap-1",
            "message-actions opacity-0 transition-opacity duration-300 ease-out",
            "group-hover/msg:opacity-100 focus-within:opacity-100",
          )}
        >
          <button
            type="button"
            onClick={() => void copyContent()}
            className={msgIconBtn}
            title={copied ? "Copied" : "Copy"}
            aria-label={copied ? "Copied" : "Copy message"}
          >
            {copied ? (
              <Check size={msgIconSize} strokeWidth={msgIconStroke} />
            ) : (
              <Copy size={msgIconSize} strokeWidth={msgIconStroke} />
            )}
          </button>
          {comfyImageUrls.map((href, index) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={msgIconBtn}
              title="Open image"
              aria-label={
                comfyImageUrls.length > 1
                  ? `Open generated image ${index + 1} in new tab`
                  : "Open generated image in new tab"
              }
            >
              <Download size={msgIconSize} strokeWidth={msgIconStroke} />
            </a>
          ))}
          <MessageMoreActions
            actions={[
              {
                label: "Copy message",
                icon: <Copy size={18} />,
                onSelect: copyContent,
              },
              ...(message.steps &&
              traceStepsForDisplay(message.steps).length > 0 &&
              onViewSteps
                ? [
                    {
                      label: "View trace",
                      icon: <Waypoints size={18} />,
                      onSelect: onViewSteps,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>
    </div>
  );
}
