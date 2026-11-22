import { ModelProvider } from "../../src/gen/euler/v1/models_pb";
import { providerClient } from "../lib/rpc";

export async function loadProviderBalance(
  provider: ModelProvider = ModelProvider.OPENROUTER,
  signal?: AbortSignal,
) {
  return providerClient.getProviderBalance({ provider }, { signal });
}
