import { ChevronRight, Globe } from "lucide-react";
import { useId, useState } from "react";
import type { WebSourceAttachment } from "../../../src/attachments/types";
import { cx } from "../../styles";

const previewCount = 3;

/** Collapsed sources pill that expands into the full list of links. */
export function SourceList({ sources }: { sources: WebSourceAttachment[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const previewHosts = [
    ...new Set(sources.map((source) => new URL(source.url).hostname)),
  ].slice(0, previewCount);
  return (
    <div className="mt-3 min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-muted/40 py-1 pr-2.5 pl-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
      >
        <span className="flex items-center -space-x-1" aria-hidden>
          {previewHosts.map((host) => (
            <span
              key={host}
              className="flex size-4 items-center justify-center overflow-hidden rounded-full bg-background ring-2 ring-background"
            >
              <SourceFavicon host={host} />
            </span>
          ))}
        </span>
        <span className="tabular-nums">
          {sources.length === 1 ? "1 source" : `${sources.length} sources`}
        </span>
        <ChevronRight
          size={13}
          aria-hidden
          className={cx(
            "transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </button>
      {/* Visibility stays in the transition so the list fades out before it hides. */}
      <div
        id={listId}
        className={cx(
          "grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out motion-reduce:transition-none",
          open
            ? "grid-rows-[1fr] opacity-100"
            : "invisible grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="mt-1.5 flex max-w-lg flex-col rounded-lg border border-border-subtle p-1">
            {sources.map((source) => {
              const host = new URL(source.url).hostname;
              return (
                <li key={source.url} className="min-w-0">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={source.url}
                    className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
                  >
                    <SourceFavicon host={host} />
                    <span className="flex min-w-0 flex-1 items-center gap-2.5 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-0">
                      <span className="min-w-0 flex-1 truncate max-[640px]:w-full">
                        {source.title}
                      </span>
                      <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground max-[640px]:max-w-full">
                        {host.replace(/^www\./, "")}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SourceFavicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Globe
        size={16}
        aria-hidden="true"
        className="shrink-0 text-muted-foreground"
      />
    );
  }
  return (
    <img
      src={`/api/favicons/${encodeURIComponent(host)}`}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-sm"
    />
  );
}
