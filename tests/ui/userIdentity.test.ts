import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  USER_ID_HEADER,
  USER_ID_STORAGE_KEY,
  createBrowserUuid,
  getOrCreateUserId,
  normalizeUserId,
  resetFallbackUserIdForTests,
  switchUserId,
  userScopedFetch,
} from "../../ui/persist/userIdentity";

const storageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

beforeEach(() => {
  resetFallbackUserIdForTests();
});

afterEach(() => {
  resetFallbackUserIdForTests();
  if (storageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", storageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("browser UUID falls back to getRandomValues when randomUUID is unavailable", () => {
  let called = false;
  const uuid = createBrowserUuid({
    getRandomValues(values) {
      called = true;
      values.forEach((_, index) => {
        values[index] = index;
      });
      return values;
    },
  });

  expect(called).toBeTrue();
  expect(normalizeUserId(uuid)).toBe(uuid);
  expect(uuid[14]).toBe("4");
  expect(["8", "9", "a", "b"]).toContain(uuid.charAt(19));
});

test("browser UUID falls back when randomUUID throws on an HTTP context", () => {
  const uuid = createBrowserUuid({
    randomUUID() {
      throw new TypeError("randomUUID is unavailable");
    },
    getRandomValues(values) {
      values.fill(255);
      return values;
    },
  });

  expect(uuid).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
});

test("browser UUID has a last-resort fallback without Web Crypto", () => {
  const uuid = createBrowserUuid(null, () => 0);

  expect(uuid).toBe("00000000-0000-4000-8000-000000000000");
  expect(normalizeUserId(uuid)).toBe(uuid);
});

test("getOrCreateUserId returns the same in-memory ID across repeated calls when localStorage getItem and setItem throw", () => {
  let getCalls = 0;
  let setCalls = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        getCalls += 1;
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      setItem() {
        setCalls += 1;
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    },
  });

  const firstId = getOrCreateUserId();
  expect(firstId).toBeString();
  expect(normalizeUserId(firstId)).toBe(firstId);
  expect(getCalls).toBe(1);
  expect(setCalls).toBe(1);

  const secondId = getOrCreateUserId();
  expect(secondId).toBe(firstId);
  expect(getCalls).toBe(2);
  expect(setCalls).toBe(1);

  const thirdId = getOrCreateUserId();
  expect(thirdId).toBe(firstId);
  expect(getCalls).toBe(3);
  expect(setCalls).toBe(1);
});

test("userScopedFetch attaches consistent header with fallback ID when localStorage throws", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      setItem() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    },
  });

  const capturedHeaders: Headers[] = [];
  const fetchTarget: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  } = globalThis;
  const fetchSpy = spyOn(fetchTarget, "fetch");
  fetchSpy.mockImplementation(async (_input, init) => {
    capturedHeaders.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ ok: true }));
  });

  try {
    await userScopedFetch("/api/test-route-1");
    await userScopedFetch("/api/test-route-2");

    expect(capturedHeaders).toHaveLength(2);
    const id1 = capturedHeaders[0]!.get(USER_ID_HEADER);
    const id2 = capturedHeaders[1]!.get(USER_ID_HEADER);
    expect(id1).toBeTruthy();
    expect(normalizeUserId(id1)).toBe(id1);
    expect(id1).toBe(id2);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("getOrCreateUserId reads and persists UUID when localStorage is available", () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
      removeItem(key: string) {
        store.delete(key);
      },
    },
  });

  const id = getOrCreateUserId();
  expect(normalizeUserId(id)).toBe(id);
  expect(store.get(USER_ID_STORAGE_KEY)).toBe(id);

  const secondCall = getOrCreateUserId();
  expect(secondCall).toBe(id);
});

test("getOrCreateUserId returns existing stored UUID when already present", () => {
  const existingId = "01234567-89ab-4cde-8f01-23456789abcd";
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return key === USER_ID_STORAGE_KEY ? existingId : null;
      },
      setItem() {},
    },
  });

  expect(getOrCreateUserId()).toBe(existingId);
});

test("switchUserId updates fallback user ID when localStorage throws", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      setItem() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    },
  });

  const initialId = getOrCreateUserId();
  const nextId = "11111111-2222-4333-8444-555555555555";

  expect(switchUserId(nextId)).toBeTrue();
  expect(getOrCreateUserId()).toBe(nextId);
  expect(getOrCreateUserId()).not.toBe(initialId);
});

test("switchUserId rejects invalid IDs and leaves fallback intact when localStorage throws", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      setItem() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    },
  });

  const initialId = getOrCreateUserId();
  expect(switchUserId("not-a-valid-uuid")).toBeFalse();
  expect(getOrCreateUserId()).toBe(initialId);
});

test("getOrCreateUserId retains identity if localStorage throws after initial read", () => {
  const existingId = "22222222-3333-4444-8555-666666666666";
  let throws = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        if (throws) throw new DOMException("Insecure", "SecurityError");
        return key === USER_ID_STORAGE_KEY ? existingId : null;
      },
      setItem() {
        if (throws) throw new DOMException("Insecure", "SecurityError");
      },
    },
  });

  const firstId = getOrCreateUserId();
  expect(firstId).toBe(existingId);

  // Storage starts throwing
  throws = true;
  const secondId = getOrCreateUserId();
  expect(secondId).toBe(existingId);
});
