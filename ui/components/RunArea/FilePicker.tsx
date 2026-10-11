import { FileText } from "lucide-react";
import { cx } from "../../styles";
import type { WorkspaceFile } from "../../types";

export interface FilePickerProps {
  files: readonly WorkspaceFile[];
  status: "loading" | "error" | "ready";
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onSelectFile: (file: WorkspaceFile) => void;
}

export function FilePicker({
  files,
  status,
  selectedIndex,
  onSelectIndex,
  onSelectFile,
}: FilePickerProps) {
  return (
    <div
      id="file-picker"
      className="ui-animate-slide-up absolute inset-x-0 bottom-[calc(100%+8px)] z-30 overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-[0_14px_36px_rgba(0,0,0,0.42)]"
      aria-label="Available files"
    >
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <FileText size={13} />
        Files
      </div>
      <div className="max-h-64 overflow-y-auto p-1.5">
        {files.length === 0 && (
          <output className="px-2.5 py-2 text-xs text-muted-foreground">
            {status === "loading"
              ? "Loading files..."
              : status === "error"
                ? "Could not load workspace files"
                : "No matching files"}
          </output>
        )}
        {files.map((file, index) => (
          <button
            key={file.path}
            type="button"
            title={file.path}
            aria-current={index === selectedIndex}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onSelectIndex(index)}
            onClick={() => onSelectFile(file)}
            className={cx(
              "flex w-full min-w-0 items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
              index === selectedIndex
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] font-medium text-foreground">
              @{file.path}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
