import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  fetchAttachmentImage,
  releaseAttachmentImage,
  retainAttachmentImage,
} from "../../ui/persist/attachments";
import { fetchSession, fetchSessionSummaries } from "../../ui/persist/sessions";

/** The attachment a GetAttachmentData request names. */
const requestedId = (init: RequestInit | undefined) => {
  const body = init?.body;
  const text =
    body instanceof Uint8Array ? new TextDecoder().decode(body) : String(body);
  return (JSON.parse(text) as { id: string }).id;
};
const image = () =>
  Response.json({ mimeType: "image/png", data: btoa("image") });

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
  fetchSpy.mockImplementation(async (_input, init) => {
    requests.push(requestedId(init));
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          bodies.push(controller);
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  const finish = (index: number) => {
    bodies[index]!.enqueue(
      new TextEncoder().encode(
        JSON.stringify({ mimeType: "image/png", data: btoa("image") }),
      ),
    );
    bodies[index]!.close();
  };
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
  finish(0);
  await first;
  expect(requests).toEqual(["queue-first", "queue-second", "queue-third"]);
  finish(1);
  await second;
  expect(requests[3]).toBe("queue-fourth");
  finish(2);
  finish(3);
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
  expect(await result).toBeDefined();
  fetchSpy.mockResolvedValue(
    Response.json({ code: "internal", message: "failed" }, { status: 500 }),
  );
  await expect(
    Promise.resolve(fetchAttachmentImage("retry")),
  ).rejects.toBeInstanceOf(Error);
  fetchSpy.mockImplementation(async () => image());
  expect(await fetchAttachmentImage("retry")).toStartWith("blob:");
});

test("image cache returns synchronously, evicts LRU entries, and keeps mounted URLs alive", async () => {
  fetchSpy.mockImplementation(async () => image());
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
      session: {
        id: "shared",
        history: [{ role: "ROLE_USER", content: "full history" }],
      },
    }),
  );
  expect((await first)?.history).toHaveLength(1);
  await second;
  fetchSpy.mockResolvedValue(
    Response.json(
      { code: "not_found", message: "Session not found" },
      {
        status: 404,
      },
    ),
  );
  expect(await fetchSession("shared")).toBeNull();
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  fetchSpy.mockRejectedValue(new Error("offline"));
  await expect(fetchSession("shared")).rejects.toThrow();
  fetchSpy.mockResolvedValue(Response.json({ session: { id: "shared" } }));
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
  older.resolve(Response.json({ session: { id: "stream-race", history: [] } }));
  await snapshot;
  expect(fetchSession("stream-race")).toBe(completion);
  newer.resolve(
    Response.json({
      session: {
        id: "stream-race",
        history: [{ role: "ROLE_ASSISTANT", content: "new" }],
      },
    }),
  );
  expect((await completion)?.history).toHaveLength(1);
});

test("session summaries keep the server's most-recent-first order and decode timestamps", async () => {
  fetchSpy.mockResolvedValue(
    Response.json({
      sessions: [
        { id: "s2", updatedAt: "1970-01-01T00:00:00.500Z", preview: "Chat 2" },
        { id: "s1", updatedAt: "1970-01-01T00:00:00.200Z", preview: "Chat 1" },
      ],
    }),
  );
  const summaries = await fetchSessionSummaries();
  expect(summaries.map((session) => session.id)).toEqual(["s2", "s1"]);
  expect(Number(summaries[0]?.updatedAt?.nanos)).toBe(500_000_000);
});

test("a malformed session list fails instead of passing untyped data on", async () => {
  fetchSpy.mockResolvedValue(Response.json({ sessions: "not-an-array" }));
  await expect(fetchSessionSummaries()).rejects.toThrow();
});
