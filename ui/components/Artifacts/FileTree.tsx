import { ChevronDown, ChevronRight, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DirectoryEntry } from "../../../src/schemas/artifacts";
import { RefreshButton } from "../RefreshButton";
import { FileIcon } from "./FileIcon";
import type { ArtifactPreviewCache } from "./previewCache";

type DirectoryProps = {
  source: ArtifactPreviewCache;
  active: boolean;
  path: string;
  onOpen: (path: string) => void;
  revision: number;
  root?: { label: string; onRefresh: () => void };
};
function Directory({
  source,
  active,
  path,
  onOpen,
  revision,
  root,
}: DirectoryProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(true);
    void source
      .list(path, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setEntries(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Could not load folder",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source, path, revision]);
  useEffect(() => {
    if (!active || !listRef.current) return;
    const queued = new Map<Element, () => void>();
    const observer = new IntersectionObserver((changes) => {
      for (const change of changes) {
        const path = (change.target as HTMLElement).dataset.filePath;
        if (!path) continue;
        if (change.isIntersecting && !queued.has(change.target))
          queued.set(change.target, source.prefetch(path));
        else if (!change.isIntersecting) {
          queued.get(change.target)?.();
          queued.delete(change.target);
        }
      }
    });
    for (const element of listRef.current.querySelectorAll(
      ":scope > li > button[data-file-path]",
    ))
      observer.observe(element);
    return () => {
      observer.disconnect();
      for (const cancel of queued.values()) cancel();
    };
  }, [active, entries, source]);
  const content = (
    <>
      {error && (
        <p role="alert" className="p-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {!entries && loading && (
        <output className="p-2 text-xs text-muted-foreground">
          Loading files…
        </output>
      )}
      {entries?.length === 0 && (
        <p className="p-2 text-xs text-muted-foreground">
          No files in this folder.
        </p>
      )}
      <ul ref={listRef} className="min-w-0">
        {entries?.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              data-file-path={entry.kind === "file" ? entry.path : undefined}
              aria-expanded={
                entry.kind === "directory"
                  ? expanded.has(entry.path)
                  : undefined
              }
              onClick={() =>
                entry.kind === "file"
                  ? onOpen(entry.path)
                  : setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(entry.path)) next.delete(entry.path);
                      else next.add(entry.path);
                      return next;
                    })
              }
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent-ring"
              title={entry.path}
            >
              {entry.kind === "directory" &&
                (expanded.has(entry.path) ? (
                  <ChevronDown
                    size={14}
                    className="shrink-0 text-muted-foreground"
                  />
                ) : (
                  <ChevronRight
                    size={14}
                    className="shrink-0 text-muted-foreground"
                  />
                ))}
              <FileIcon
                path={entry.path}
                directory={entry.kind === "directory"}
                expanded={expanded.has(entry.path)}
                className={entry.kind === "file" ? "ml-[22px]" : undefined}
              />
              <span className="truncate">{entry.name}</span>
            </button>
            {entry.kind === "directory" && expanded.has(entry.path) && (
              <div className="ml-3 border-l border-border-subtle pl-1">
                <Directory
                  active={active}
                  source={source}
                  path={entry.path}
                  onOpen={onOpen}
                  revision={revision}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
  return root ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="workspace-header gap-2 pl-3 pr-12">
        <FolderOpen size={16} className="shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={root.label}
        >
          {root.label}
        </span>
        <RefreshButton
          iconOnly
          label="Refresh files"
          refreshing={loading}
          onClick={root.onRefresh}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{content}</div>
    </div>
  ) : (
    content
  );
}
export function FileTree({
  source,
  active,
  onOpen,
  rootLabel,
}: {
  source: ArtifactPreviewCache;
  active: boolean;
  onOpen: (path: string) => void;
  rootLabel: string;
}) {
  const [refresh, setRefresh] = useState(0);
  return (
    <Directory
      source={source}
      active={active}
      path="."
      onOpen={onOpen}
      revision={refresh}
      root={{
        label: rootLabel,
        onRefresh: () => {
          source.clear();
          setRefresh((value) => value + 1);
        },
      }}
    />
  );
}
