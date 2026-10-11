import { openRouterBalanceSchema } from "../../src/schemas/openRouterBalance";
import { globalApiJson } from "../lib/api";

export async function loadOpenRouterBalance(signal?: AbortSignal) {
  return openRouterBalanceSchema.parse(
    await globalApiJson<unknown>("/api/settings/openrouter/balance", {
      signal,
    }),
  );
}
