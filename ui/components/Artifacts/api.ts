import {
  DirectoryListingSchema,
  FilePreviewSchema,
} from "../../../src/schemas/artifacts";
import { apiBlob, apiJson } from "../../lib/api";

export type ArtifactSource = {
  download: (path: string, signal: AbortSignal) => Promise<Blob>;
  list: (
    path: string,
    signal: AbortSignal,
  ) => Promise<import("../../../src/schemas/artifacts").DirectoryEntry[]>;
  preview: (
    path: string,
    signal: AbortSignal,
  ) => Promise<import("../../../src/schemas/artifacts").FilePreview>;
};

export function workspaceArtifactSource(
  sessionId: string,
  temporary: boolean,
): ArtifactSource {
  const base = temporary
    ? `/api/temporary-sessions/${encodeURIComponent(sessionId)}/artifacts`
    : `/api/sessions/${encodeURIComponent(sessionId)}/workspace/artifacts`;

  return {
    download: (path, signal) =>
      apiBlob(`${base}/download?path=${encodeURIComponent(path)}`, { signal }),
    list: async (path, signal) => {
      const data = await apiJson<unknown>(
        `${base}/tree?path=${encodeURIComponent(path)}`,
        { signal },
      );
      return DirectoryListingSchema.parse(data).entries;
    },
    preview: async (path, signal) => {
      const data = await apiJson<unknown>(
        `${base}/preview?path=${encodeURIComponent(path)}`,
        { signal },
      );
      return FilePreviewSchema.parse(data);
    },
  };
}
