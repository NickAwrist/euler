import { z } from "zod";
import type { SearXNGResult } from "../searxng/client";

const responseSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          description: z.string().optional(),
        }),
      ),
    })
    .optional(),
});

export async function searchBrave(
  apiKey: string,
  query: string,
  count: number,
): Promise<SearXNGResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.floor(count)));
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Brave Search returned HTTP ${response.status}`);
  const data = responseSchema.parse(await response.json());
  return (data.web?.results ?? []).slice(0, count).map((result) => ({
    title: result.title,
    url: result.url,
    content: result.description ?? "No description available.",
    engine: "Brave",
  }));
}
