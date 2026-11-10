import type { ImageAttachment } from "../../src/gen/euler/v1/attachments_pb";
import { attachmentClient } from "../lib/rpc";

export async function uploadImageAttachment(
  sessionId: string,
  file: File,
): Promise<ImageAttachment> {
  const { attachment } = await attachmentClient.createAttachment({
    sessionId,
    filename: file.name,
    mimeType: file.type,
    data: new Uint8Array(await file.arrayBuffer()),
  });
  if (!attachment) throw new Error("The server returned an invalid image");
  return attachment;
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
          const { mimeType, data } = await attachmentClient.getAttachmentData(
            { id },
            { signal },
          );
          const blob = new Blob([new Uint8Array(data)], { type: mimeType });
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
