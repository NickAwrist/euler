import { z } from "zod";
import type { OpenRouterBalance } from "./schemas/openRouterBalance";

const keySchema = z.object({
  data: z.object({
    limit: z.number().nullable(),
    limit_remaining: z.number().nullable(),
    limit_reset: z.string().nullable(),
    usage: z.number(),
  }),
});
const creditsSchema = z.object({
  data: z.object({ total_credits: z.number(), total_usage: z.number() }),
});

/** The configured secret stays on the server; provider bodies are never forwarded. */
export async function fetchOpenRouterBalance(
  apiKey: string,
  request: typeof fetch = fetch,
): Promise<OpenRouterBalance> {
  const options = {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  };
  const [keyResponse, creditsResponse] = await Promise.all([
    request("https://openrouter.ai/api/v1/key", options),
    request("https://openrouter.ai/api/v1/credits", options),
  ]);
  if (
    !keyResponse.ok ||
    (!creditsResponse.ok && creditsResponse.status !== 403)
  )
    throw new Error("Could not load OpenRouter balance");
  const { data: key } = keySchema.parse(await keyResponse.json());
  const credits = creditsResponse.ok
    ? creditsSchema.parse(await creditsResponse.json()).data
    : null;
  return {
    accountBalance: credits
      ? credits.total_credits - credits.total_usage
      : null,
    keyLimit: key.limit,
    keyRemaining: key.limit_remaining,
    keyLimitReset: key.limit_reset,
    keyUsage: key.usage,
  };
}
