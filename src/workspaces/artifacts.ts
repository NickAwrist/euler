import { posix } from "node:path";
import type { FilePreview } from "../schemas/artifacts";
import {
  type Workspace,
  WorkspaceError,
  type WorkspaceService,
} from "./WorkspaceService";

const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const imageTypes: Record<
  string,
  Extract<FilePreview, { kind: "image" }>["mediaType"]
> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

export async function listArtifactDirectory(
  service: WorkspaceService,
  workspace: Workspace,
  path: string,
) {
  const entries = await service.readVisibleDirectory(workspace, path);
  return entries
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => ({
      name: entry.name,
      path: posix.join(path, entry.name),
      kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
    }))
    .sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name)
        : a.kind === "directory"
          ? -1
          : 1,
    );
}

export async function readArtifactPreview(
  service: WorkspaceService,
  workspace: Workspace,
  path: string,
): Promise<FilePreview> {
  const mediaType = imageTypes[posix.extname(path).toLowerCase()];
  const limit = mediaType ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
  const limitMessage = mediaType
    ? "Image preview is limited to files up to 10 MB"
    : "Preview is limited to files up to 1 MB";
  const file = await service.openFile(workspace, path);
  try {
    if ((await file.stat()).size > limit)
      throw new WorkspaceError(limitMessage);
    // Bound the read even if another process grows the file after stat.
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new WorkspaceError(limitMessage);
    const bytes = buffer.subarray(0, length);
    if (mediaType)
      return { kind: "image", path, mediaType, data: bytes.toString("base64") };
    if (bytes.includes(0))
      throw new WorkspaceError("This binary file cannot be previewed as text");
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new WorkspaceError("This file is not UTF-8 text");
    }
    return { kind: "text", path, content };
  } finally {
    await file.close();
  }
}
