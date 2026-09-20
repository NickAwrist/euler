import { useEffect, useMemo, useState } from "react";
import { ArtifactSidebar } from "./ArtifactSidebar";
import { FilePreview } from "./FilePreview";
import { FileTree } from "./FileTree";
import type { ArtifactSource } from "./api";
import { ArtifactPreviewCache } from "./previewCache";

export function WorkspaceArtifacts({
  source,
  open,
  path,
  revision,
  rootLabel,
  onOpen,
  onBack,
  onClose,
}: {
  source: ArtifactSource;
  open: boolean;
  path: string | null;
  revision: number;
  rootLabel: string;
  onOpen: (path: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const cache = useMemo(
    () => new ArtifactPreviewCache(source),
    [source, revision],
  );
  useEffect(() => () => cache.clear(), [cache]);
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    if (open) setActivated(true);
  }, [open]);
  return (
    <ArtifactSidebar open={open} onClose={onClose}>
      {(open || activated) && (
        <>
          <div hidden={path !== null} className="min-h-0 flex-1">
            <FileTree
              source={cache}
              active={open && path === null}
              onOpen={onOpen}
              rootLabel={rootLabel}
            />
          </div>
          {path !== null && (
            <FilePreview
              key={path}
              source={cache}
              path={path}
              onBack={onBack}
            />
          )}
        </>
      )}
    </ArtifactSidebar>
  );
}
