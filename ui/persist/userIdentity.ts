const USER_ID_STORAGE_KEY = "euler:userUuid";
const USER_ID_HEADER = "X-Euler-User-ID";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BrowserCryptoApi = {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint8Array) => Uint8Array;
};

export function normalizeUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function createBrowserUuid(
  cryptoApi: BrowserCryptoApi | null | undefined = globalThis.crypto,
  random: () => number = Math.random,
): string {
  if (typeof cryptoApi?.randomUUID === "function") {
    try {
      return cryptoApi.randomUUID().toLowerCase();
    } catch {
      // Firefox can expose Web Crypto without allowing randomUUID on HTTP.
    }
  }

  const bytes = new Uint8Array(16);
  let populated = false;
  if (typeof cryptoApi?.getRandomValues === "function") {
    try {
      cryptoApi.getRandomValues(bytes);
      populated = true;
    } catch {
      // Fall through for browsers that restrict Web Crypto in this context.
    }
  }
  if (!populated) {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(random() * 256);
    }
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

import { safeStorage } from "../lib/safeStorage";

export function getOrCreateUserId(): string {
  const stored = normalizeUserId(safeStorage.getItem(USER_ID_STORAGE_KEY));
  if (stored) return stored;
  const created = createBrowserUuid();
  safeStorage.setItem(USER_ID_STORAGE_KEY, created);
  return created;
}

export function switchUserId(value: string): boolean {
  const normalized = normalizeUserId(value);
  if (!normalized) return false;
  safeStorage.setItem(USER_ID_STORAGE_KEY, normalized);
  safeStorage.session.removeItem("activeSessionId");
  return true;
}

export function userScopedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(USER_ID_HEADER, getOrCreateUserId());
  return fetch(input, { ...init, headers });
}
