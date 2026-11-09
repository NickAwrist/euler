import { providerClient } from "../lib/rpc";

export async function loadOpenRouterBalance(signal?: AbortSignal) {
  return providerClient.getOpenRouterBalance({}, { signal });
}
