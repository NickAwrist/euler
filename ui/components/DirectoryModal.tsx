import { ArrowUp, Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type DirectoryListing,
  fetchDirectories,
} from "../persist/directories";
import { cx, inputClass } from "../styles";
import { Button } from "./Button";
import { Modal } from "./Modal";

export function DirectoryModal({
  initialPath,
  onSelect,
  onClose,
}: {
  initialPath: string;
  onSelect: (path: string) => Promise<void>;
  onClose: () => void;
}) {
  const [path, setPath] = useState(initialPath);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const resolvedPathRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (resolvedPathRef.current === path) return;
    resolvedPathRef.current = null;
    const controller = new AbortController();
    setLoading(true);
    setListing(null);
    setBrowseError(null);
    const timer = setTimeout(() => {
      void fetchDirectories(path, controller.signal).then(
        (result) => {
          if (controller.signal.aborted) return;
          setListing(result);
          setLoading(false);
          if (!path.trim() || path.trim() === "~") {
            resolvedPathRef.current = result.path;
            setPath(result.path);
          }
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setBrowseError(
            error instanceof Error
              ? error.message
              : "Could not browse directory",
          );
          setLoading(false);
        },
      );
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [path]);

  // Typing a partial name (for example `.co`) already filters explicitly.
  const directories =
    listing?.exact && !showHidden
      ? listing.directories.filter(
          (directory) => !directory.name.startsWith("."),
        )
      : listing?.directories;

  function navigate(nextPath: string) {
    setPath(nextPath);
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <Modal
      title="Choose working directory"
      subtitle="The agent can read, edit, and run commands in this folder."
      onClose={onClose}
      closeDisabled={pending}
      hideCloseButton
      maxWidthClass="max-w-[640px]"
      layout="flex"
      surfaceClassName="overflow-hidden max-h-[calc(100dvh-32px)]"
      initialFocusRef={inputRef}
    >
      <form
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || !path.trim()) return;
          setPending(true);
          setError(null);
          try {
            await onSelect(listing?.exact ? listing.path : path.trim());
            onClose();
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Could not select directory",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <input
            id="directory-path"
            ref={inputRef}
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
              setError(null);
            }}
            disabled={pending}
            required
            autoComplete="off"
            spellCheck={false}
            aria-label="Folder path"
            aria-invalid={error !== null}
            className={cx(inputClass, "min-w-0 flex-1 font-mono")}
          />
          <Button
            type="submit"
            size="sm"
            disabled={pending || !path.trim()}
            loading={pending}
            className="shrink-0"
          >
            Use this folder
          </Button>
        </div>
        <label className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
            className="h-3.5 w-3.5"
          />
          Show hidden folders
        </label>
        {error && (
          <p role="alert" className="px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
        <div
          className="min-h-0 h-[min(480px,65dvh)] overflow-y-auto p-1"
          aria-label="Server folders"
          aria-busy={loading}
        >
          {listing?.parent && (
            <button
              type="button"
              disabled={pending}
              onClick={() => listing.parent && navigate(listing.parent)}
              aria-label="Parent directory"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-40"
            >
              <ArrowUp size={16} className="shrink-0" />
              <span>..</span>
            </button>
          )}
          {loading && (
            <output className="px-3 py-3 text-sm text-muted-foreground">
              Loading folders…
            </output>
          )}
          {browseError && (
            <p role="alert" className="px-3 py-3 text-sm text-red-400">
              {browseError}
            </p>
          )}
          {directories?.map((directory) => (
            <button
              key={directory.path}
              type="button"
              disabled={pending}
              onClick={() => navigate(directory.path)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-40"
            >
              <Folder size={16} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{directory.name}</span>
            </button>
          ))}
          {directories?.length === 0 && (
            <output className="px-3 py-3 text-sm text-muted-foreground">
              No folders found.
            </output>
          )}
        </div>
      </form>
    </Modal>
  );
}
