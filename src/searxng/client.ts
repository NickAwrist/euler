import { parse as parseHtml } from "node-html-parser";
import { z } from "zod";
import { getSearXNGHost } from "../db/index";
import { DEFAULT_SEARXNG_HOST } from "../env";
import { providerHostConfig } from "../providerHostConfig";
import { errorMessage } from "../utils/errors";

export type SearXNGResult = {
  title: string;
  url: string;
  content: string;
  engine?: string;
};

const SearchResponseSchema = z.object({
  results: z.array(z.unknown()),
  unresponsive_engines: z.array(z.tuple([z.string(), z.string()])).optional(),
});

const REQUEST_HEADERS = {
  Accept: "application/json, text/html;q=0.9",
  "User-Agent": "Euler/1.0",
  "X-Forwarded-For": "127.0.0.1",
  "X-Real-IP": "127.0.0.1",
};

export class SearXNGClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async search(
    query: string,
    maxResults: number,
    timeoutMs = 10000,
  ): Promise<SearXNGResult[]> {
    const jsonUrl = this.searchUrl(query);
    jsonUrl.searchParams.set("format", "json");
    const jsonResponse = await fetch(jsonUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: REQUEST_HEADERS,
    });

    if (jsonResponse.ok) {
      const contentType = jsonResponse.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          `SearXNG returned ${contentType || "an unknown content type"} instead of JSON. Check the configured SearXNG address and enable search.formats: [html, json].`,
        );
      }
      let data: unknown;
      try {
        data = await jsonResponse.json();
      } catch {
        throw new Error("SearXNG returned invalid JSON.");
      }
      const parsed = SearchResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error("SearXNG returned an invalid search response.");
      }
      const results = parseSearXNGJsonResults(parsed.data.results, maxResults);
      if (results.length === 0 && parsed.data.unresponsive_engines?.length) {
        throw new Error(
          `SearXNG returned no results and reported engine failures: ${parsed.data.unresponsive_engines.map(([engine, reason]) => `${engine}: ${reason}`).join("; ")}`,
        );
      }
      return results;
    }

    if (jsonResponse.status !== 403) {
      throw new Error(`SearXNG returned HTTP ${jsonResponse.status}`);
    }

    const htmlUrl = this.searchUrl(query);
    const htmlResponse = await fetch(htmlUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...REQUEST_HEADERS, Accept: "text/html" },
    });

    if (!htmlResponse.ok) {
      throw new Error(
        `SearXNG returned HTTP ${jsonResponse.status}; HTML fallback returned HTTP ${htmlResponse.status}`,
      );
    }

    return parseSearXNGHtmlResults(await htmlResponse.text(), maxResults);
  }

  async healthCheck(
    timeoutMs = 5000,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const results = await this.search("searxng", 1, timeoutMs);
      if (results.length === 0) {
        return {
          ok: false,
          error: "SearXNG returned no results for the test query.",
        };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: errorMessage(error),
      };
    }
  }

  private searchUrl(query: string): URL {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set("q", query);
    return url;
  }
}

function parseSearXNGJsonResults(
  rows: unknown[],
  maxResults: number,
): SearXNGResult[] {
  const out: SearXNGResult[] = [];

  for (const row of rows) {
    if (out.length >= maxResults) break;
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const result = row as Record<string, unknown>;
    const title = typeof result.title === "string" ? result.title.trim() : "";
    const url = typeof result.url === "string" ? result.url.trim() : "";
    if (!title && !url) continue;
    out.push({
      title: title || url,
      url,
      content:
        typeof result.content === "string" && result.content.trim()
          ? cleanText(result.content)
          : "No description available.",
      engine:
        typeof result.engine === "string" ? result.engine.trim() : undefined,
    });
  }

  return out;
}

function parseSearXNGHtmlResults(
  html: string,
  maxResults: number,
): SearXNGResult[] {
  const root = parseHtml(html);
  if (!root.querySelector('meta[name="endpoint"][content="results"]')) {
    throw new Error(
      "SearXNG returned an unexpected HTML page. Check the configured SearXNG address.",
    );
  }
  const nodes = root.querySelectorAll("article.result");
  const out: SearXNGResult[] = [];

  for (const node of nodes) {
    if (out.length >= maxResults) break;
    const titleAnchor =
      node.querySelector("h3 a") ?? node.querySelector(".url_header");
    const urlAnchor = node.querySelector(".url_header") ?? titleAnchor;
    const title = cleanText(titleAnchor?.text ?? "");
    const url = urlAnchor?.getAttribute("href")?.trim() ?? "";
    if (!title && !url) continue;
    out.push({
      title: title || url,
      url,
      content:
        cleanText(node.querySelector(".content")?.text ?? "") ||
        "No description available.",
    });
  }

  if (out.length === 0) {
    const failures = root
      .querySelectorAll("#engines_msg tr")
      .filter((row) => row.querySelector(".response-error"))
      .map(
        (row) =>
          `${cleanText(row.querySelector(".engine-name")?.text ?? "")}: ${cleanText(row.querySelector(".response-error")?.text ?? "")}`,
      );
    if (failures.length) {
      throw new Error(
        `SearXNG returned no results and reported engine failures: ${failures.join("; ")}`,
      );
    }
  }
  return out;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

let clientInstance: SearXNGClient | null = null;
let cachedHost: string | null = null;

export function getResolvedSearXNGHost(): string {
  return getSearXNGHostConfig().effectiveHost;
}

export function getSearXNGHostConfig(): {
  host: string;
  effectiveHost: string;
} {
  const configuredHost = getSearXNGHost();
  return providerHostConfig({
    host: configuredHost === DEFAULT_SEARXNG_HOST ? "" : configuredHost,
    fallbackHost: DEFAULT_SEARXNG_HOST,
    normalize: (host) => host.replace(/\/+$/, ""),
  });
}

export function getSearXNGClient(): SearXNGClient {
  const host = getResolvedSearXNGHost();
  if (!clientInstance || cachedHost !== host) {
    clientInstance = new SearXNGClient(host);
    cachedHost = host;
  }
  return clientInstance;
}

export function invalidateSearXNGClient(): void {
  clientInstance = null;
  cachedHost = null;
}
