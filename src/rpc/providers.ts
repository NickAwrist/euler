import type { ServiceImpl } from "@connectrpc/connect";
import { Ollama } from "ollama";
import {
  getBraveSearchApiKey,
  getOllamaContextWindow,
  getOpenRouterApiKey,
  getVercelGatewayApiKey,
  setBraveSearchApiKey,
  setOllamaContextWindow,
  setOllamaHost,
  setOpenRouterApiKey,
  setVercelGatewayApiKey,
} from "../db/index";
import {
  getOpenRouterModelByRoute,
  removeOpenRouterPublisher,
  setOpenRouterModelEnabled,
  setPublisherSubscription,
  trackOpenRouterPublisher,
} from "../db/openrouter";
import { envConfig } from "../env";
import { ModelProvider } from "../gen/euler/v1/models_pb";
import {
  ApiKeyProvider,
  OllamaContextWindow,
  type ProviderService,
} from "../gen/euler/v1/providers_pb";
import { canEditEnvironmentSetting } from "../http/environmentSettings";
import { listImageModels } from "../imageGen/index";
import type { CatalogProvider } from "../llm/types";
import {
  chatGptStatus,
  disconnectChatGpt,
  finishChatGptLogin,
  startChatGptLogin,
} from "../models/chatgpt";
import { withContainerLoopbackHint } from "../models/containerNetworkHint";
import {
  getOllamaClient,
  getOllamaHostConfig,
  invalidateOllamaClientCache,
  normalizeOllamaHost,
} from "../models/ollamaClient";
import { fetchProviderBalance } from "../models/openRouterBalance";
import {
  type CatalogResult,
  isInteractiveModel,
  openRouterRouteSchema,
} from "../models/openRouterModels";
import {
  catalogSettings,
  getCatalogPreferences,
  savedModelMetadata,
} from "../models/openRouterPreferences";
import { modelCatalogWire } from "../models/openRouterWire";
import { OperationError } from "../observability/errors";
import { choices, imageProviders } from "../preferences/wire";
import type { OllamaContextWindow as ContextWindow } from "../schemas/ollama";
import { errorMessage } from "../utils/errors";
import { ownerOf } from "./context";

const API_KEYS = {
  [ApiKeyProvider.OPENROUTER]: {
    environment: () => envConfig.openrouterApiKey,
    get: getOpenRouterApiKey,
    set: setOpenRouterApiKey,
  },
  [ApiKeyProvider.BRAVE]: {
    environment: () => envConfig.braveSearchApiKey,
    get: getBraveSearchApiKey,
    set: setBraveSearchApiKey,
  },
  [ApiKeyProvider.VERCEL_GATEWAY]: {
    environment: () => envConfig.vercelGatewayApiKey,
    get: getVercelGatewayApiKey,
    set: setVercelGatewayApiKey,
  },
} as const;

const apiKey = (provider: ApiKeyProvider) =>
  API_KEYS[provider as keyof typeof API_KEYS];

const contextWindows = choices<ContextWindow, OllamaContextWindow>({
  low: OllamaContextWindow.LOW,
  medium: OllamaContextWindow.MEDIUM,
  high: OllamaContextWindow.HIGH,
});

function chatGpt(owner: string) {
  const status = chatGptStatus(owner);
  return {
    connected: status.connected,
    email: status.email ?? undefined,
    planEnabled: status.planEnabled,
    name: status.name ?? undefined,
    picture: status.picture ?? undefined,
  };
}

const CATALOG_PROVIDERS: Partial<Record<ModelProvider, CatalogProvider>> = {
  [ModelProvider.OPENROUTER]: "openrouter",
  [ModelProvider.VERCEL_GATEWAY]: "vercel_gateway",
};

function catalogProviderOf(provider: ModelProvider): CatalogProvider {
  const resolved = CATALOG_PROVIDERS[provider];
  if (!resolved) {
    throw new OperationError("INVALID_REQUEST", {
      message: "Unsupported catalog provider",
    });
  }
  return resolved;
}

const catalog = (
  result: CatalogResult,
  owner: string,
  provider: CatalogProvider,
) => modelCatalogWire(catalogSettings(result, owner, provider));

/** A catalog fetched for a write; the write needs its models. */
async function requireCatalog(provider: CatalogProvider) {
  const result = await getCatalogPreferences(false, true, undefined, provider);
  if (!result.models) throw new OperationError("CATALOG_UNAVAILABLE");
  return result.models;
}

export const providerService: ServiceImpl<typeof ProviderService> = {
  getOllamaConfig() {
    return {
      config: getOllamaHostConfig(),
      contextWindow: contextWindows.toProto(getOllamaContextWindow()),
    };
  },
  updateOllamaConfig(request) {
    const host = request.host.trim();
    if (canEditEnvironmentSetting(envConfig.ollamaHost, host))
      setOllamaHost(host);
    invalidateOllamaClientCache();
    return { config: getOllamaHostConfig() };
  },
  setOllamaContextWindow(request) {
    const contextWindow = contextWindows.fromProto(request.contextWindow);
    if (contextWindow) setOllamaContextWindow(contextWindow);
    return { contextWindow: contextWindows.toProto(getOllamaContextWindow()) };
  },
  async getOllamaHealth() {
    try {
      await getOllamaClient().list();
      return { connected: true };
    } catch (error) {
      return { connected: false, error: errorMessage(error) };
    }
  },
  async testOllamaHost(request) {
    const host = request.host.trim();
    let client: Ollama;
    let effectiveHost: string;
    try {
      client = host ? new Ollama({ host }) : new Ollama();
      effectiveHost = normalizeOllamaHost(host);
    } catch (error) {
      return { result: { ok: false, error: errorMessage(error) } };
    }
    try {
      const { version } = await client.version();
      return { result: { ok: true, version } };
    } catch (error) {
      return {
        result: {
          ok: false,
          error: withContainerLoopbackHint(
            errorMessage(error),
            host || effectiveHost,
          ),
        },
      };
    }
  },
  getApiKey(request) {
    const key = apiKey(request.provider);
    return {
      state: {
        hasKey: key.get().length > 0,
        environmentManaged: Boolean(key.environment()),
      },
    };
  },
  setApiKey(request) {
    const key = apiKey(request.provider);
    if (canEditEnvironmentSetting(key.environment(), request.apiKey))
      key.set(request.apiKey);
    return {
      state: {
        hasKey: key.get().length > 0,
        environmentManaged: Boolean(key.environment()),
      },
    };
  },
  async getProviderBalance(request) {
    const provider = catalogProviderOf(request.provider);
    const key =
      provider === "vercel_gateway"
        ? getVercelGatewayApiKey()
        : getOpenRouterApiKey();
    if (!key)
      throw new OperationError("INVALID_REQUEST", {
        message: `Configure ${provider === "vercel_gateway" ? "a Vercel AI Gateway" : "an OpenRouter"} API key first`,
      });
    const balance = await fetchProviderBalance(provider, key);
    return {
      accountBalance: balance.accountBalance ?? undefined,
      keyLimit: balance.keyLimit ?? undefined,
      keyRemaining: balance.keyRemaining ?? undefined,
      keyLimitReset: balance.keyLimitReset ?? undefined,
      keyUsage: balance.keyUsage,
    };
  },
  async getModelCatalog(request, context) {
    const owner = ownerOf(context);
    const provider = catalogProviderOf(request.provider);
    return {
      catalog: catalog(
        await getCatalogPreferences(false, false, undefined, provider),
        owner,
        provider,
      ),
    };
  },
  async refreshModelCatalog(request, context) {
    const owner = ownerOf(context);
    const provider = catalogProviderOf(request.provider);
    return {
      catalog: catalog(
        await getCatalogPreferences(true, false, undefined, provider),
        owner,
        provider,
      ),
    };
  },
  async setCatalogModelEnabled(request) {
    const provider = catalogProviderOf(request.provider);
    if (!openRouterRouteSchema.safeParse(request.route).success)
      throw new OperationError("INVALID_REQUEST", {
        message: "Provide a route and enabled boolean",
      });
    const saved = getOpenRouterModelByRoute(request.route, provider);
    if (!request.enabled && saved) {
      setOpenRouterModelEnabled(savedModelMetadata(saved), false, provider);
      return {};
    }
    const model = (await requireCatalog(provider)).find(
      (entry) => entry.route === request.route,
    );
    if (!model || !isInteractiveModel(model))
      throw new OperationError("INVALID_REQUEST", {
        message: "Model is not available for interactive use",
      });
    setOpenRouterModelEnabled(model, request.enabled, provider);
    return {};
  },
  async trackCatalogPublisher(request) {
    const provider = catalogProviderOf(request.provider);
    const models = await requireCatalog(provider);
    if (
      !models.some(
        (model) =>
          model.publisherId === request.publisherId &&
          isInteractiveModel(model),
      )
    )
      throw new OperationError("INVALID_REQUEST", {
        message: "Choose a publisher from the catalog",
      });
    trackOpenRouterPublisher(request.publisherId, provider);
    return {};
  },
  removeCatalogPublisher(request) {
    const provider = catalogProviderOf(request.provider);
    if (!removeOpenRouterPublisher(request.publisherId, provider))
      throw new OperationError("NOT_FOUND", { message: "Publisher not found" });
    return {};
  },
  setCatalogSubscription(request) {
    const provider = catalogProviderOf(request.provider);
    if (
      !setPublisherSubscription(
        request.publisherId,
        request.subscribed,
        undefined,
        provider,
      )
    )
      throw new OperationError("NOT_FOUND", { message: "Publisher not found" });
    return {};
  },
  async listImageModels(request) {
    const provider = imageProviders.fromProto(request.provider) || undefined;
    const result = await listImageModels(provider, request.refresh);
    return {
      models: result.models.map((model) => ({
        id: model.id,
        name: model.name,
        provider: imageProviders.toProto(model.provider),
        aspectRatios: model.aspectRatios,
      })),
      error: result.error,
    };
  },
  getChatGptStatus(_request, context) {
    return { status: chatGpt(ownerOf(context)) };
  },
  startChatGptLogin(request, context) {
    return startChatGptLogin(ownerOf(context), request.newAccount);
  },
  async finishChatGptLogin(request, context) {
    const owner = ownerOf(context);
    try {
      await finishChatGptLogin(owner, request.callbackUrl);
    } catch (error) {
      throw new OperationError("INVALID_REQUEST", {
        message:
          error instanceof OperationError
            ? error.message
            : "ChatGPT sign-in failed. Start again and paste the complete callback URL.",
      });
    }
    return { status: chatGpt(owner) };
  },
  async disconnectChatGpt(_request, context) {
    return disconnectChatGpt(ownerOf(context));
  },
};
