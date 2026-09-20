import {
  type ImageAttachment,
  ImageAttachmentSchema,
} from "../../src/attachments/types";
import { apiBlob, apiJson } from "../lib/api";

export async function uploadImageAttachment(
  sessionId: string,
  file: File,
): Promise<ImageAttachment> {
  const payload = await apiJson<{ attachment?: unknown }>("/api/attachments", {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-Euler-Session-ID": sessionId,
      "X-Attachment-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const parsed = ImageAttachmentSchema.safeParse(payload.attachment);
  if (!parsed.success) throw new Error("The server returned an invalid image");
  return parsed.data;
}

const imageCache = new Map<string, string>();
const imageUsers = new Map<string, number>();

export function retainAttachmentImage(url: string) {
  imageUsers.set(url, (imageUsers.get(url) ?? 0) + 1);
}

export function releaseAttachmentImage(url: string) {
  const remaining = (imageUsers.get(url) ?? 1) - 1;
  if (remaining > 0) imageUsers.set(url, remaining);
  else {
    imageUsers.delete(url);
    if (![...imageCache.values()].includes(url)) URL.revokeObjectURL(url);
  }
}

export function invalidateAttachmentImage(id: string) {
  const url = imageCache.get(id);
  if (!url) return;
  imageCache.delete(id);
  if (!imageUsers.has(url)) URL.revokeObjectURL(url);
}

const downloadQueue: Array<() => void> = [];
let activeDownloads = 0;

function drainDownloads() {
  while (activeDownloads < 2 && downloadQueue.length > 0) {
    downloadQueue.shift()?.();
  }
}

function cachedImage(id: string): string | undefined {
  const url = imageCache.get(id);
  if (url) {
    imageCache.delete(id);
    imageCache.set(id, url);
  }
  return url;
}

// The cache owns object URLs; consumers must not revoke them on unmount.
export function fetchAttachmentImage(
  id: string,
  signal?: AbortSignal,
): string | Promise<string> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const cached = cachedImage(id);
  if (cached) return cached;

  return new Promise<string>((resolve, reject) => {
    const abort = () => {
      const index = downloadQueue.indexOf(start);
      if (index !== -1) downloadQueue.splice(index, 1);
      reject(signal?.reason);
    };
    const start = () => {
      signal?.removeEventListener("abort", abort);
      activeDownloads++;
      void (async () => {
        try {
          signal?.throwIfAborted();
          const existing = cachedImage(id);
          if (existing) {
            resolve(existing);
            return;
          }
          const blob = await apiBlob(
            `/api/attachments/${encodeURIComponent(id)}`,
            { signal },
          );
          signal?.throwIfAborted();
          const url = cachedImage(id) ?? URL.createObjectURL(blob);
          imageCache.set(id, url);
          if (imageCache.size > 60) {
            const oldest = imageCache.entries().next().value;
            if (oldest) {
              invalidateAttachmentImage(oldest[0]);
            }
          }
          resolve(url);
        } catch (error) {
          reject(error);
        } finally {
          activeDownloads--;
          drainDownloads();
        }
      })();
    };
    signal?.addEventListener("abort", abort, { once: true });
    downloadQueue.push(start);
    drainDownloads();
  });
}
