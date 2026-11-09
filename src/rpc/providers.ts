import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import type { ServiceImpl } from "@connectrpc/connect";
import { Ollama } from "ollama";
import {
  ComfyUIClient,
  getComfyUIClient,
  getComfyUIHostConfig,
  getResolvedComfyUIHost,
  invalidateComfyUIClient,
} from "../comfyui/client";
import {
  getBraveSearchApiKey,
  getOpenRouterApiKey,
  setBraveSearchApiKey,
  setComfyUIHost,
  setOllamaHost,
  setOpenRouterApiKey,
} from "../db/index";
import {
  getOpenRouterModelByRoute,
  removeOpenRouterPublisher,
  setOpenRouterModelEnabled,
  setPublisherSubscription,
  trackOpenRouterPublisher,
} from "../db/openrouter";
import {
  effectiveUserPreferences,
  updateUserPreferences,
} from "../db/userPreferences";
import { envConfig } from "../env";
import { Model_Availability } from "../gen/euler/v1/models_pb";
import {
  ApiKeyProvider,
  CatalogFreshness_Status,
  type ProviderService,
} from "../gen/euler/v1/providers_pb";
import { canEditEnvironmentSetting } from "../http/environmentSettings";
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
import { fetchOpenRouterBalance } from "../models/openRouterBalance";
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
import { OperationError } from "../observability/errors";
import { logEvent } from "../observability/logger";
import { errorMessage } from "../utils/errors";
import { ownerOf } from "./context";
import { inputCapabilities, reasoning } from "./models";
import { imagePatch } from "./preferences";
import { optionalMillis } from "./wire";

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
} as const;

const apiKey = (provider: ApiKeyProvider) =>
  API_KEYS[provider as keyof typeof API_KEYS];

const FRESHNESS = {
  fresh: CatalogFreshness_Status.FRESH,
  stale: CatalogFreshness_Status.STALE,
  unavailable: CatalogFreshness_Status.UNAVAILABLE,
} as const;
const AVAILABILITY = {
  available: Model_Availability.AVAILABLE,
  unavailable: Model_Availability.UNAVAILABLE,
  unverified: Model_Availability.UNVERIFIED,
} as const;

function comfyConfig(owner: string) {
  return {
    config: getComfyUIHostConfig(),
    image: effectiveUserPreferences(owner).image,
  };
}

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

function catalog(result: CatalogResult, owner: string) {
  const settings = catalogSettings(result, owner);
  return {
    catalog: {
      status: FRESHNESS[settings.catalog.status],
      lastSuccessfulFetchAt: optionalMillis(
        settings.catalog.lastSuccessfulFetchAt,
      ),
      error: settings.catalog.error ?? undefined,
    },
    publishers: settings.publishers.map((publisher) => ({
      id: publisher.id,
      name: publisher.name,
      subscribed: publisher.subscribed,
      subscribedAt: optionalMillis(publisher.subscribedAt),
      enabledCount: publisher.enabledCount,
      recentCount: publisher.recentCount ?? undefined,
    })),
    modelsByPublisher: Object.fromEntries(
      Object.entries(settings.modelsByPublisher).map(([id, models]) => [
        id,
        {
          models: models.map((model) => ({
            route: model.route,
            publisherId: model.publisherId,
            name: model.name,
            description: model.description,
            created: timestampFromMs(model.created * 1000),
            contextLength: model.contextLength ?? undefined,
            promptPricePerMillion: model.promptPricePerMillion ?? undefined,
            completionPricePerMillion:
              model.completionPricePerMillion ?? undefined,
            inputCapabilities: inputCapabilities(model.inputCapabilities),
            supportsTools: model.supportsTools,
            outputCapabilities: model.outputCapabilities,
            reasoning: reasoning(model.reasoning),
            enabled: model.enabled,
            favorite: model.favorite,
            availability: AVAILABILITY[model.availability],
            isNew: model.isNew,
          })),
        },
      ]),
    ),
    discoveredPublishers: settings.discoveredPublishers
      ? { publishers: settings.discoveredPublishers }
      : undefined,
  };
}

/** A catalog fetched for a write; the write needs its models. */
async function requireCatalog() {
  const result = await getCatalogPreferences(false, true);
  if (!result.models) throw new OperationError("CATALOG_UNAVAILABLE");
  return result.models;
}

export const providerService: ServiceImpl<typeof ProviderService> = {
  getOllamaConfig() {
    return { config: getOllamaHostConfig() };
  },
  updateOllamaConfig(request) {
    const host = request.host.trim();
    if (canEditEnvironmentSetting(envConfig.ollamaHost, host))
      setOllamaHost(host);
    invalidateOllamaClientCache();
    return { config: getOllamaHostConfig() };
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
  getComfyUiConfig(_request, context) {
    return comfyConfig(ownerOf(context));
  },
  updateComfyUiConfig(request, context) {
    const owner = ownerOf(context);
    if (request.host !== undefined) {
      if (canEditEnvironmentSetting(envConfig.comfyuiHost, request.host))
        setComfyUIHost(request.host);
      invalidateComfyUIClient();
    }
    const image = imagePatch(request.image);
    if (image) updateUserPreferences(owner, { image });
    return comfyConfig(owner);
  },
  async getComfyUiHealth() {
    try {
      const result = await getComfyUIClient().healthCheck();
      return { connected: result.ok, error: result.error };
    } catch (error) {
      logEvent("warn", "comfyui.unavailable", { stage: "health" }, error);
      return { connected: false, error: errorMessage(error) };
    }
  },
  async testComfyUiHost(request) {
    const url = request.host.trim() || getResolvedComfyUIHost();
    const result = await new ComfyUIClient(url).healthCheck();
    return {
      result: {
        ok: result.ok,
        error: result.error
          ? withContainerLoopbackHint(result.error, url)
          : undefined,
      },
    };
  },
  async listComfyUiModels() {
    try {
      return { models: await getComfyUIClient().getModels() };
    } catch (error) {
      logEvent("warn", "comfyui.unavailable", { stage: "models" }, error);
      return { models: [], error: errorMessage(error) };
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
  async getOpenRouterBalance() {
    const key = getOpenRouterApiKey();
    if (!key)
      throw new OperationError("INVALID_REQUEST", {
        message: "Configure an OpenRouter API key first",
      });
    const balance = await fetchOpenRouterBalance(key);
    return {
      accountBalance: balance.accountBalance ?? undefined,
      keyLimit: balance.keyLimit ?? undefined,
      keyRemaining: balance.keyRemaining ?? undefined,
      keyLimitReset: balance.keyLimitReset ?? undefined,
      keyUsage: balance.keyUsage,
    };
  },
  async getOpenRouterCatalog(request, context) {
    const owner = ownerOf(context);
    return catalog(await getCatalogPreferences(request.refresh), owner);
  },
  async setOpenRouterModelEnabled(request) {
    if (!openRouterRouteSchema.safeParse(request.route).success)
      throw new OperationError("INVALID_REQUEST", {
        message: "Provide a route and enabled boolean",
      });
    const saved = getOpenRouterModelByRoute(request.route);
    if (!request.enabled && saved) {
      setOpenRouterModelEnabled(savedModelMetadata(saved), false);
      return {};
    }
    const model = (await requireCatalog()).find(
      (entry) => entry.route === request.route,
    );
    if (!model || !isInteractiveModel(model))
      throw new OperationError("INVALID_REQUEST", {
        message: "Model is not available for interactive use",
      });
    setOpenRouterModelEnabled(model, request.enabled);
    return {};
  },
  async trackOpenRouterPublisher(request) {
    const models = await requireCatalog();
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
    trackOpenRouterPublisher(request.publisherId);
    return {};
  },
  removeOpenRouterPublisher(request) {
    if (!removeOpenRouterPublisher(request.publisherId))
      throw new OperationError("NOT_FOUND", { message: "Publisher not found" });
    return {};
  },
  setOpenRouterSubscription(request) {
    if (!setPublisherSubscription(request.publisherId, request.subscribed))
      throw new OperationError("NOT_FOUND", { message: "Publisher not found" });
    return {};
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
