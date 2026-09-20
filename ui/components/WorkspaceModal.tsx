import { Download, FolderOpen, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadBlob } from "../lib/downloadBlob";
import { readApiError } from "../lib/readApiError";
import { fetchWorkspaceFiles } from "../persist/sessions";
import { userScopedFetch } from "../persist/userIdentity";
import {
  modalCloseButton,
  modalHeader,
  modalShell,
  modalSurface,
} from "../styles";
import type { SessionWorkspace, WorkspaceFile } from "../types";

export function WorkspaceModal({
  sessionId,
  workspace,
  temporary,
  onClose,
}: {
  sessionId: string;
  workspace: SessionWorkspace;
  temporary: boolean;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchWorkspaceFiles(sessionId, temporary)
      .then((value) => {
        if (!cancelled) setFiles(value);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Could not load files",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, temporary]);

  const download = async (file: WorkspaceFile) => {
    const path = temporary
      ? `/api/temporary-sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(file.path)}`
      : `/api/sessions/${encodeURIComponent(sessionId)}/workspace/file?path=${encodeURIComponent(file.path)}`;
    const response = await userScopedFetch(path);
    if (!response.ok) throw new Error(await readApiError(response));
    downloadBlob(await response.blob(), file.name);
  };

  const reveal = async (file: WorkspaceFile) => {
    const base = temporary
      ? `/api/temporary-sessions/${encodeURIComponent(sessionId)}`
      : `/api/sessions/${encodeURIComponent(sessionId)}/workspace`;
    const response = await userScopedFetch(`${base}/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file.path }),
    });
    if (!response.ok) throw new Error(await readApiError(response));
  };

  return (
    <dialog open className={modalShell} aria-label="Workspace files">
      <div className={`${modalSurface} w-full max-w-2xl`}>
        <div className={modalHeader}>
          <div>
            <h2 className="text-sm font-semibold">Workspace files</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {workspace.kind === "local"
                ? workspace.path
                : "Private chat workspace"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={modalCloseButton}
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>
        <div className="min-h-48 overflow-y-auto p-3">
          {error && <p className="text-sm text-red-300">{error}</p>}
          {!error && files === null && (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <LoaderCircle className="animate-spin" size={18} />
            </div>
          )}
          {files?.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No files yet.
            </p>
          )}
          {files?.map((file) => (
            <div
              key={file.path}
              className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60"
            >
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm text-foreground"
                  title={file.path}
                >
                  {file.path}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                title={
                  workspace.kind === "local" ? "Reveal file" : "Download file"
                }
                onClick={() =>
                  void (
                    workspace.kind === "local" ? reveal(file) : download(file)
                  ).catch((cause) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "File action failed",
                    ),
                  )
                }
              >
                {workspace.kind === "local" ? (
                  <FolderOpen size={15} />
                ) : (
                  <Download size={15} />
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
