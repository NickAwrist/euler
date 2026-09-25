import { Check, Copy, Download, Globe, Waypoints } from "lucide-react";
import type { CSSProperties } from "react";
import type {
  WebSourceAttachment,
  WorkspaceFileAttachment,
} from "../../../src/attachments/types";
import { cx } from "../../styles";
import type { Message } from "../../types";
import { useArtifacts } from "../Artifacts/ArtifactContext";
import { FileIcon } from "../Artifacts/FileIcon";
import { traceStepsForDisplay } from "../ExecutionTrace";
import {
  ComfyUIImageCard,
  MarkdownMessage,
  extractComfyUIImageUrls,
} from "../MarkdownMessage";
import { MessageActions } from "./MessageActions";
import {
  msgIconBtn,
  msgIconSize,
  msgIconStroke,
  msgOutputChip,
} from "./messageItemStyles";

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
  const attachments = message.attachments ?? [];
  const markdownImageUrls = extractComfyUIImageUrls(message.content);
  // Tool results keep generated images visible when the reply omits their URLs.
  const generatedImageUrls = attachments.flatMap((attachment) =>
    attachment.kind === "generated_image" &&
    !markdownImageUrls.includes(attachment.url)
      ? [attachment.url]
      : [],
  );
  const comfyImageUrls = [...markdownImageUrls, ...generatedImageUrls];
  const outputFiles = attachments.filter(
    (attachment): attachment is WorkspaceFileAttachment =>
      attachment.kind === "file",
  );
  const sources = attachments.filter(
    (attachment): attachment is WebSourceAttachment =>
      attachment.kind === "web_source",
  );
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
          {generatedImageUrls.length > 0 && (
            <div className="flex flex-wrap gap-x-3">
              {generatedImageUrls.map((src) => (
                <ComfyUIImageCard key={src} src={src} />
              ))}
            </div>
          )}
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
                  className={msgOutputChip}
                >
                  <FileIcon path={file.path} />
                  <span className="min-w-0 truncate">{file.name}</span>
                </button>
              ))}
            </div>
          )}
          {sources.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {sources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={source.url}
                  className={msgOutputChip}
                >
                  <Globe
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 max-w-64 truncate">
                    {source.title}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {sourceDomain(source.url)}
                  </span>
                </a>
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
          <MessageActions
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
              ...(message.steps &&
              traceStepsForDisplay(message.steps).length > 0 &&
              onViewSteps
                ? [
                    {
                      label: "View trace",
                      icon: (
                        <Waypoints
                          size={msgIconSize}
                          strokeWidth={msgIconStroke}
                        />
                      ),
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

function sourceDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}
