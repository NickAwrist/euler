import { parse as parseHtml } from "node-html-parser";
import { z } from "zod";
import { getBraveSearchApiKey } from "../db/index";

export type BraveSearchResult = {
  title: string;
  url: string;
  content: string;
};

const SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
/** Brave enforces a per-second request limit; back off before retrying. */
const RATE_LIMIT_RETRY_DELAYS_MS = [1000, 2000];

const SearchResponseSchema = z.object({
  web: z.object({ results: z.array(z.unknown()) }).optional(),
});

const ResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
});

const ErrorResponseSchema = z.object({
  error: z.object({ detail: z.string() }),
});

export async function searchBrave(
  query: string,
  maxResults: number,
  timeoutMs = 10000,
): Promise<BraveSearchResult[]> {
  const apiKey = getBraveSearchApiKey();
  if (!apiKey) {
    throw new Error(
      "Brave Search API key is not configured. Add one in Settings > Web Search.",
    );
  }

  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    });
    const retryDelay = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
    if (response.status !== 429 || retryDelay === undefined) break;
    await Bun.sleep(retryDelay);
  }

  if (!response.ok) {
    throw new Error(await describeError(response));
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("Brave Search returned invalid JSON.");
  }
  const parsed = SearchResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Brave Search returned an invalid search response.");
  }

  return (parsed.data.web?.results ?? [])
    .flatMap((row): BraveSearchResult[] => {
      const result = ResultSchema.safeParse(row);
      if (!result.success) return [];
      const title = htmlToText(result.data.title);
      const resultUrl = result.data.url.trim();
      if (!title && !resultUrl) return [];
      return [
        {
          title: title || resultUrl,
          url: resultUrl,
          content:
            htmlToText(result.data.description ?? "") ||
            "No description available.",
        },
      ];
    })
    .slice(0, maxResults);
}

async function describeError(response: Response): Promise<string> {
  const status = `Brave Search returned HTTP ${response.status}`;
  if (response.status === 429) {
    return `${status}: rate limit reached. If this persists, the monthly quota may be used up.`;
  }
  const body = ErrorResponseSchema.safeParse(
    await response.json().catch(() => null),
  );
  return body.success ? `${status}: ${body.data.error.detail}` : status;
}

/** Brave highlights query terms with HTML tags and escapes entities. */
function htmlToText(value: string): string {
  return parseHtml(value).text.replace(/\s+/g, " ").trim();
}
