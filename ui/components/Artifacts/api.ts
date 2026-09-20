import {
  DirectoryListingSchema,
  FilePreviewSchema,
} from "../../../src/schemas/artifacts";
import { readApiError } from "../../lib/readApiError";
import { userScopedFetch } from "../../persist/userIdentity";
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
  async function get(
    action: string,
    path: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await userScopedFetch(
      `${base}/${action}?path=${encodeURIComponent(path)}`,
      { signal },
    );
    if (!response.ok) throw new Error(await readApiError(response));
    return response.json();
  }
  return {
    download: async (path, signal) => {
      const response = await userScopedFetch(
        `${base}/download?path=${encodeURIComponent(path)}`,
        { signal },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      return response.blob();
    },
    list: async (path, signal) =>
      DirectoryListingSchema.parse(await get("tree", path, signal)).entries,
    preview: async (path, signal) =>
      FilePreviewSchema.parse(await get("preview", path, signal)),
  };
}
