import dns from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { parse as parseHtml } from "node-html-parser";

export type Favicon = { contentType: string; body: Uint8Array };

const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const MAX_ICON_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const USER_AGENT = "Euler/1.0 (favicon fetcher)";

// Addresses the server must never be tricked into requesting. IPv4 rules
// also match IPv4-mapped IPv6 addresses.
const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

const cache = new Map<
  string,
  { expiresAt: number; favicon: Promise<Favicon | null> }
>();

/** Returns the site's favicon, or null when it cannot be fetched safely. */
export function getFavicon(hostname: string): Promise<Favicon | null> {
  const cached = cache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.favicon;
  cache.delete(hostname);
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const favicon = fetchFavicon(hostname).catch(() => null);
  cache.set(hostname, { expiresAt: Date.now() + CACHE_TTL_MS, favicon });
  return favicon;
}

async function fetchFavicon(hostname: string): Promise<Favicon | null> {
  const icon = await fetchIcon(new URL(`https://${hostname}/favicon.ico`));
  if (icon) return icon;

  const page = await fetchPublic(new URL(`https://${hostname}/`), "text/html");
  if (!page) return null;
  const html = await readLimited(page.response, MAX_HTML_BYTES, "truncate");
  if (!html) return null;
  const link = parseHtml(new TextDecoder().decode(html))
    .querySelectorAll("link[rel][href]")
    .find((node) =>
      (node.getAttribute("rel") ?? "")
        .toLowerCase()
        .split(/\s+/)
        .includes("icon"),
    );
  const href = link?.getAttribute("href");
  if (!href) return null;
  try {
    return await fetchIcon(new URL(href, page.url));
  } catch {
    return null;
  }
}

async function fetchIcon(url: URL): Promise<Favicon | null> {
  const result = await fetchPublic(url, "image/*");
  if (!result) return null;
  const contentType =
    result.response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!contentType.startsWith("image/")) {
    await result.response.body?.cancel();
    return null;
  }
  const body = await readLimited(result.response, MAX_ICON_BYTES, "reject");
  return body && body.length > 0 ? { contentType, body } : null;
}

/** Follows redirects manually so every hop is checked against private networks. */
async function fetchPublic(
  initialUrl: URL,
  accept: string,
): Promise<{ response: Response; url: URL } | null> {
  let url = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (!(await isPublicHost(url.hostname))) return null;

    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: accept, "User-Agent": USER_AGENT },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return { response, url };
  }
  return null;
}

async function isPublicHost(rawHostname: string): Promise<boolean> {
  const hostname = rawHostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await dns.lookup(hostname, { all: true })).map(
        (entry) => entry.address,
      );
    } catch {
      return false;
    }
  }
  return (
    addresses.length > 0 &&
    addresses.every(
      (address) =>
        !blockedAddresses.check(address, isIP(address) === 6 ? "ipv6" : "ipv4"),
    )
  );
}

async function readLimited(
  response: Response,
  maxBytes: number,
  overflow: "truncate" | "reject",
): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      if (overflow === "reject") return null;
      chunks.push(value.subarray(0, value.length - (size - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
