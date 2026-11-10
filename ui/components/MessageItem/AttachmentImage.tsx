import { useEffect, useRef, useState } from "react";
import type { ImageAttachment } from "../../../src/gen/euler/v1/attachments_pb";
import {
  fetchAttachmentImage,
  invalidateAttachmentImage,
  releaseAttachmentImage,
  retainAttachmentImage,
} from "../../persist/attachments";

export function AttachmentImage({
  attachment,
}: { attachment: ImageAttachment }) {
  return <AttachmentPreview key={attachment.id} attachment={attachment} />;
}

function AttachmentPreview({ attachment }: { attachment: ImageAttachment }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let retainedUrl: string | undefined;
    let observer: IntersectionObserver | undefined;
    const load = () => {
      observer?.disconnect();
      setErrored(false);
      void Promise.resolve(
        fetchAttachmentImage(attachment.id, controller.signal),
      )
        .then((objectUrl) => {
          if (!controller.signal.aborted) {
            retainAttachmentImage(objectUrl);
            retainedUrl = objectUrl;
            setUrl(objectUrl);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setErrored(true);
        });
    };
    // RunArea first mounts at the top, then scrolls to the latest message.
    const frame = requestAnimationFrame(() => {
      if (attempt > 0 || typeof IntersectionObserver === "undefined") {
        load();
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) load();
        },
        { rootMargin: "350px 0px" },
      );
      if (containerRef.current) observer.observe(containerRef.current);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      controller.abort();
      if (retainedUrl) releaseAttachmentImage(retainedUrl);
    };
  }, [attachment.id, attempt]);

  return (
    <div
      ref={containerRef}
      className="flex h-48 w-72 max-w-full items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-background/30 text-center text-xs text-muted-foreground"
    >
      {errored ? (
        <div
          className="flex flex-col items-center gap-2 px-3"
          aria-live="polite"
        >
          <span>Failed to load {attachment.name}</span>
          <button
            type="button"
            className="rounded px-3 py-1 underline hover:text-foreground"
            onClick={() => {
              setUrl(null);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={attachment.name}
          className="block h-full w-full"
        >
          <img
            src={url}
            alt={attachment.name}
            decoding="async"
            onError={() => {
              invalidateAttachmentImage(attachment.id);
              setErrored(true);
            }}
            className="h-full w-full object-contain"
          />
        </a>
      ) : (
        <span className="px-3">{attachment.name}</span>
      )}
    </div>
  );
}
