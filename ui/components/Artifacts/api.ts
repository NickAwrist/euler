import type {
  ArtifactEntry,
  ArtifactPreview,
} from "../../../src/gen/euler/v1/workspace_pb";
import { workspaceClient } from "../../lib/rpc";
import { downloadWorkspaceFile } from "../../persist/sessions";

export type ArtifactSource = {
  download: (path: string, signal: AbortSignal) => Promise<Blob>;
  list: (path: string, signal: AbortSignal) => Promise<ArtifactEntry[]>;
  preview: (path: string, signal: AbortSignal) => Promise<ArtifactPreview>;
};

export function workspaceArtifactSource(sessionId: string): ArtifactSource {
  return {
    download: (path, signal) => downloadWorkspaceFile(sessionId, path, signal),
    list: async (path, signal) =>
      (await workspaceClient.listArtifacts({ sessionId, path }, { signal }))
        .entries,
    preview: async (path, signal) =>
      (await workspaceClient.previewArtifact({ sessionId, path }, { signal }))
        .preview!,
  };
}
