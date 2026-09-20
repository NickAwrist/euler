import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  fetchAttachmentImage,
  releaseAttachmentImage,
  retainAttachmentImage,
} from "../../ui/persist/attachments";
import { fetchSession } from "../../ui/persist/sessions";

const storageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const fetchTarget: {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
} = globalThis;
let fetchSpy: ReturnType<typeof spyOn<typeof fetchTarget, "fetch">>;

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => "00000000-0000-4000-8000-000000000001" },
  });
  fetchSpy = spyOn(fetchTarget, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
  if (storageDescriptor)
    Object.defineProperty(globalThis, "localStorage", storageDescriptor);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("image queue holds slots through body consumption, skips aborted work, and stays FIFO", async () => {
  const bodies: ReadableStreamDefaultController<Uint8Array>[] = [];
  const requests: string[] = [];
  fetchSpy.mockImplementation(async (input) => {
    requests.push(String(input));
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          bodies.push(controller);
        },
      }),
    );
  });
  const first = fetchAttachmentImage("queue-first");
  const second = fetchAttachmentImage("queue-second");
  const controller = new AbortController();
  const cancelled = Promise.resolve(
    fetchAttachmentImage("queue-cancelled", controller.signal),
  ).catch((error: unknown) => error);
  const third = fetchAttachmentImage("queue-third");
  const fourth = fetchAttachmentImage("queue-fourth");
  await Promise.resolve();
  expect(requests).toHaveLength(2);
  controller.abort();
  expect(await cancelled).toBeInstanceOf(DOMException);
  bodies[0]!.close();
  await first;
  expect(requests).toEqual([
    "/api/attachments/queue-first",
    "/api/attachments/queue-second",
    "/api/attachments/queue-third",
  ]);
  bodies[1]!.close();
  await second;
  expect(requests[3]).toBe("/api/attachments/queue-fourth");
  bodies[2]!.close();
  bodies[3]!.close();
  await Promise.all([third, fourth]);
});

test("active abort reaches fetch and frees its slot; failures can be retried", async () => {
  fetchSpy.mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      }),
  );
  const controller = new AbortController();
  const request = Promise.resolve(
    fetchAttachmentImage("abort-active", controller.signal),
  );
  const result = request.catch((error: unknown) => error);
  controller.abort();
  expect(await result).toBeInstanceOf(DOMException);
  fetchSpy.mockResolvedValue(new Response("failed", { status: 500 }));
  await expect(
    Promise.resolve(fetchAttachmentImage("retry")),
  ).rejects.toBeInstanceOf(Error);
  fetchSpy.mockImplementation(async () => new Response("image"));
  expect(await fetchAttachmentImage("retry")).toStartWith("blob:");
});

test("image cache returns synchronously, evicts LRU entries, and keeps mounted URLs alive", async () => {
  fetchSpy.mockImplementation(async () => new Response("image"));
  const revoke = spyOn(URL, "revokeObjectURL");
  try {
    const url = await fetchAttachmentImage("cache-pinned");
    retainAttachmentImage(url);
    expect(fetchAttachmentImage("cache-pinned")).toBe(url);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 60; i++) await fetchAttachmentImage(`cache-${i}`);
    expect(revoke.mock.calls.some(([value]) => value === url)).toBe(false);
    releaseAttachmentImage(url);
    expect(revoke).toHaveBeenCalledWith(url);
    const calls = fetchSpy.mock.calls.length;
    expect(typeof fetchAttachmentImage("cache-0")).toBe("string");
    await fetchAttachmentImage("cache-extra");
    expect(typeof fetchAttachmentImage("cache-0")).toBe("string");
    await fetchAttachmentImage("cache-1");
    expect(fetchSpy.mock.calls.length).toBe(calls + 2);
  } finally {
    revoke.mockRestore();
  }
});

test("session requests share a pending promise and refetch after settling", async () => {
  const pending = Promise.withResolvers<Response>();
  fetchSpy.mockReturnValue(pending.promise);
  const first = fetchSession("shared");
  const second = fetchSession("shared");
  expect(second).toBe(first);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  pending.resolve(
    Response.json({
      id: "shared",
      history: [{ role: "user", content: "full history" }],
    }),
  );
  expect((await first)?.history).toHaveLength(1);
  await second;
  fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));
  expect(await fetchSession("shared")).toBeNull();
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  fetchSpy.mockRejectedValue(new Error("offline"));
  await expect(fetchSession("shared")).rejects.toThrow("offline");
  fetchSpy.mockResolvedValue(Response.json({ id: "shared" }));
  expect((await fetchSession("shared"))?.id).toBe("shared");
});

test("stream completion requests fresh history without losing deduplication when the old snapshot settles", async () => {
  const older = Promise.withResolvers<Response>();
  const newer = Promise.withResolvers<Response>();
  fetchSpy
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise);
  const snapshot = fetchSession("stream-race");
  const completion = fetchSession("stream-race", { fresh: true });
  expect(completion).not.toBe(snapshot);
  older.resolve(Response.json({ id: "stream-race", history: [] }));
  await snapshot;
  expect(fetchSession("stream-race")).toBe(completion);
  newer.resolve(
    Response.json({
      id: "stream-race",
      history: [{ role: "assistant", content: "new" }],
    }),
  );
  expect((await completion)?.history).toHaveLength(1);
});

test("fetchSessionSummaries parses valid sessions using SessionSummaryListSchema and sorts by updatedAt desc", async () => {
  const { fetchSessionSummaries } = await import("../../ui/persist/sessions");
  fetchSpy.mockResolvedValue(
    Response.json({
      sessions: [
        { id: "s1", createdAt: 100, updatedAt: 200, preview: "Chat 1" },
        { id: "s2", createdAt: 100, updatedAt: 500, preview: "Chat 2" },
      ],
    }),
  );

  const summaries = await fetchSessionSummaries();
  expect(summaries).toEqual([
    { id: "s2", createdAt: 100, updatedAt: 500, preview: "Chat 2" },
    { id: "s1", createdAt: 100, updatedAt: 200, preview: "Chat 1" },
  ]);
});

test("fetchSessionSummaries returns empty array when schema parsing fails", async () => {
  const { fetchSessionSummaries } = await import("../../ui/persist/sessions");
  fetchSpy.mockResolvedValue(
    Response.json({
      sessions: "not-an-array",
    }),
  );

  const summaries = await fetchSessionSummaries();
  expect(summaries).toEqual([]);
});
