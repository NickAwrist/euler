import { expect, test } from "bun:test";
import type { FilePreview } from "../../src/schemas/artifacts";
import type { ArtifactSource } from "../../ui/components/Artifacts/api";
import { ArtifactPreviewCache } from "../../ui/components/Artifacts/previewCache";

function fixture() {
  const requests: {
    path: string;
    signal: AbortSignal;
    resolve: (preview: FilePreview) => void;
    reject: (error: Error) => void;
  }[] = [];
  const source: ArtifactSource = {
    download: async () => new Blob(),
    list: async () => [],
    preview: (path, signal) =>
      new Promise((resolve, reject) =>
        requests.push({ path, signal, resolve, reject }),
      ),
  };
  return { cache: new ArtifactPreviewCache(source), requests };
}
const value = (path: string, content = path): FilePreview => ({
  kind: "text",
  path,
  content,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("preview requests share in-flight prefetch and cache the result", async () => {
  const { cache, requests } = fixture();
  cache.prefetch("readme.md");
  const opened = cache.preview("readme.md", new AbortController().signal);
  expect(requests).toHaveLength(1);
  requests[0]!.resolve(value("readme.md"));
  expect(await opened).toEqual(value("readme.md"));
  expect(cache.peek("readme.md")).toEqual(value("readme.md"));
  await cache.preview("readme.md", new AbortController().signal);
  expect(requests).toHaveLength(1);
});

test("prefetch concurrency is bounded, invisible queued files cancel, and clicks bypass the queue", async () => {
  const { cache, requests } = fixture();
  cache.prefetch("one");
  cache.prefetch("two");
  const cancel = cache.prefetch("three");
  cache.prefetch("four");
  expect(requests.map((request) => request.path)).toEqual(["one", "two"]);
  cancel();
  const clicked = cache.preview("clicked", new AbortController().signal);
  expect(requests[2]!.path).toBe("clicked");
  requests[2]!.resolve(value("clicked"));
  await clicked;
  requests[0]!.resolve(value("one"));
  await settle();
  expect(requests.map((request) => request.path)).toEqual([
    "one",
    "two",
    "clicked",
    "four",
  ]);
  requests[1]!.resolve(value("two"));
  requests[3]!.resolve(value("four"));
  await settle();
  cache.clear();
});

test("refresh rejects stale in-flight results and starts a new request", async () => {
  const { cache, requests } = fixture();
  const before = cache.preview("file", new AbortController().signal);
  const rejected = before.then(
    () => false,
    () => true,
  );
  cache.invalidate("file");
  expect(requests[0]!.signal.aborted).toBe(true);
  const after = cache.preview("file", new AbortController().signal);
  requests[1]!.resolve(value("file", "new"));
  await after;
  requests[0]!.resolve(value("file", "old"));
  expect(await rejected).toBe(true);
  expect(cache.peek("file")).toEqual(value("file", "new"));
});

test("clearing a workspace aborts pending work and drops queued files", async () => {
  const { cache, requests } = fixture();
  for (const path of ["one", "two", "three"]) cache.prefetch(path);
  cache.clear();
  expect(requests.every((request) => request.signal.aborted)).toBe(true);
  for (const request of requests) request.resolve(value(request.path));
  await settle();
  expect(requests).toHaveLength(2);
  expect(cache.peek("one")).toBeNull();
});

test("background failures do not prevent an explicit retry", async () => {
  const { cache, requests } = fixture();
  cache.prefetch("missing");
  requests[0]!.reject(new Error("Missing"));
  await settle();
  const retry = cache.preview("missing", new AbortController().signal);
  expect(requests).toHaveLength(2);
  requests[1]!.resolve(value("missing"));
  await retry;
});

test("cache evicts old entries and does not retain oversized previews", async () => {
  const source: ArtifactSource = {
    download: async () => new Blob(),
    list: async () => [],
    preview: async (path) =>
      value(path, path === "large" ? "a".repeat(9 * 1024 * 1024) : path),
  };
  const cache = new ArtifactPreviewCache(source);
  const signal = new AbortController().signal;
  for (let i = 0; i < 33; i++) await cache.preview(String(i), signal);
  expect(cache.peek("0")).toBeNull();
  expect(cache.peek("32")).not.toBeNull();
  await cache.preview("large", signal);
  expect(cache.peek("large")).toBeNull();
  cache.clear();
});
