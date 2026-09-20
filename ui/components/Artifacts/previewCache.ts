import type { FilePreview } from "../../../src/schemas/artifacts";
import type { ArtifactSource } from "./api";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 32;
const MAX_AGE_MS = 30_000;
const PREFETCH_CONCURRENCY = 2;

// One instance belongs to one workspace snapshot. Explicit reads share any
// in-flight prefetch, but bypass the queue when a user opens another file.
export class ArtifactPreviewCache implements ArtifactSource {
  private values = new Map<
    string,
    { preview: FilePreview; bytes: number; expires: number }
  >();
  private pending = new Map<
    string,
    { controller: AbortController; promise: Promise<FilePreview> }
  >();
  private queue = new Map<string, number>();
  private bytes = 0;
  private prefetching = 0;

  constructor(private readonly source: ArtifactSource) {}

  download: ArtifactSource["download"] = (path, signal) =>
    this.source.download(path, signal);

  list: ArtifactSource["list"] = (path, signal) =>
    this.source.list(path, signal);

  peek(path: string): FilePreview | null {
    const entry = this.values.get(path);
    if (!entry) return null;
    if (entry.expires <= Date.now()) {
      this.remove(path);
      return null;
    }
    this.values.delete(path);
    this.values.set(path, entry);
    return entry.preview;
  }

  private remove(path: string) {
    const entry = this.values.get(path);
    if (entry) this.bytes -= entry.bytes;
    this.values.delete(path);
  }

  invalidate(path: string) {
    this.remove(path);
    this.pending.get(path)?.controller.abort();
    this.pending.delete(path);
    this.queue.delete(path);
  }

  clear() {
    this.queue.clear();
    for (const { controller } of this.pending.values()) controller.abort();
    this.pending.clear();
    this.values.clear();
    this.bytes = 0;
  }

  private load(path: string): Promise<FilePreview> {
    const cached = this.peek(path);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(path);
    if (existing) return existing.promise;
    this.queue.delete(path);
    const controller = new AbortController();
    const promise = this.source
      .preview(path, controller.signal)
      .then((preview) => {
        controller.signal.throwIfAborted();
        const bytes =
          (preview.kind === "text"
            ? preview.content.length
            : preview.data.length) * 2;
        if (bytes <= MAX_BYTES) {
          this.remove(path);
          while (
            this.values.size >= MAX_ENTRIES ||
            this.bytes + bytes > MAX_BYTES
          ) {
            const oldest = this.values.keys().next().value;
            if (oldest === undefined) break;
            this.remove(oldest);
          }
          this.values.set(path, {
            preview,
            bytes,
            expires: Date.now() + MAX_AGE_MS,
          });
          this.bytes += bytes;
        }
        return preview;
      })
      .finally(() => {
        if (this.pending.get(path)?.controller === controller)
          this.pending.delete(path);
      });
    this.pending.set(path, { controller, promise });
    return promise;
  }

  preview: ArtifactSource["preview"] = async (path, signal) => {
    signal.throwIfAborted();
    const preview = await this.load(path);
    signal.throwIfAborted();
    return preview;
  };

  prefetch(path: string): () => void {
    if (!this.peek(path) && !this.pending.has(path)) {
      this.queue.set(path, (this.queue.get(path) ?? 0) + 1);
      this.pump();
    }
    return () => {
      const count = this.queue.get(path) ?? 0;
      if (count <= 1) this.queue.delete(path);
      else this.queue.set(path, count - 1);
    };
  }

  private pump() {
    while (this.prefetching < PREFETCH_CONCURRENCY && this.queue.size) {
      const path = this.queue.keys().next().value;
      if (path === undefined) return;
      this.queue.delete(path);
      this.prefetching++;
      // Background failures are reported only if the user opens that file.
      void this.load(path)
        .catch(() => {})
        .finally(() => {
          this.prefetching--;
          this.pump();
        });
    }
  }
}
