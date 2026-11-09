import { Download, FolderOpen, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadBlob } from "../lib/downloadBlob";
import { localWorkspace } from "../lib/workspace";
import {
  downloadWorkspaceFile,
  fetchWorkspaceFiles,
  revealWorkspaceFile,
} from "../persist/sessions";
import type { SessionWorkspace, WorkspaceFile } from "../types";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

export function WorkspaceModal({
  sessionId,
  workspace,
  linkedLabel,
  onClose,
}: {
  sessionId: string;
  workspace: SessionWorkspace;
  /** The chat whose sandbox this chat is linked to, if any. */
  linkedLabel: string | null;
  onClose: () => void;
}) {
  const local = localWorkspace(workspace);
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspaceFiles(sessionId)
      .then((incoming) => {
        if (!cancelled) {
          setFiles(incoming);
          setError(null);
        }
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
  }, [sessionId]);

  const download = async (file: WorkspaceFile) => {
    const blob = await downloadWorkspaceFile(sessionId, file.path);
    downloadBlob(blob, file.name);
  };

  const reveal = async (file: WorkspaceFile) => {
    await revealWorkspaceFile(sessionId, file.path);
  };

  return (
    <Modal
      title="Workspace files"
      subtitle={
        local
          ? local.path
          : linkedLabel
            ? `Linked to ${linkedLabel}'s workspace`
            : "Private chat workspace"
      }
      ariaLabel="Workspace files"
      onClose={onClose}
      maxWidthClass="max-w-2xl"
    >
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
              <p className="truncate text-sm text-foreground" title={file.path}>
                {file.path}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(Number(file.size))}
              </p>
            </div>
            <IconButton
              size="sm"
              variant="ghost"
              icon={local ? FolderOpen : Download}
              title={local ? "Reveal file" : "Download file"}
              label={local ? "Reveal file" : "Download file"}
              onClick={() =>
                void (local ? reveal(file) : download(file)).catch((cause) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "File action failed",
                  ),
                )
              }
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
