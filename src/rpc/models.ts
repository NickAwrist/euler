import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ServiceImpl } from "@connectrpc/connect";
import { getOpenRouterApiKey, listOpenRouterModels } from "../db/index";
import {
  listModelFavorites,
  listOpenRouterPublishers,
  setModelFavorite,
} from "../db/openrouter";
import {
  InputCapability,
  type Model,
  ModelProvider,
  ModelSchema,
  type ModelService,
} from "../gen/euler/v1/models_pb";
import { openRouterModelId } from "../llm/index";
import { ollamaReasoning } from "../llm/ollamaProvider";
import { chatGptModels, chatGptStatus } from "../models/chatgpt";
import { getOllamaClient } from "../models/ollamaClient";
import { openRouterRouteSchema } from "../models/openRouterModels";
import {
  getCatalogPreferences,
  publisherModels,
} from "../models/openRouterPreferences";
import { publisherName } from "../models/openRouterPublishers";
import {
  AVAILABILITY,
  inputCapabilities,
  reasoning,
} from "../models/openRouterWire";
import { OperationError } from "../observability/errors";
import { errorMessage } from "../utils/errors";
import { ownerOf } from "./context";

const PROVIDERS = {
  [ModelProvider.OLLAMA]: "ollama",
  [ModelProvider.OPENROUTER]: "openrouter",
  [ModelProvider.CHATGPT]: "chatgpt",
} as const;

async function ollamaModels(owner: string): Promise<Model[]> {
  const favorites = listModelFavorites(owner);
  const { models } = await getOllamaClient().list();
  const shown = await Promise.allSettled(
    models.map((model) => getOllamaClient().show({ model: model.name })),
  );
  return models.map((model, index) => {
    const details = shown[index];
    const capabilities =
      details?.status === "fulfilled" &&
      Array.isArray(details.value.capabilities)
        ? details.value.capabilities
        : [];
    const modified = new Date(model.modified_at);
    return create(ModelSchema, {
      id: model.name,
      name: model.name,
      provider: ModelProvider.OLLAMA,
      lab: "Ollama",
      favorite: favorites.some(
        (row) => row.provider === "ollama" && row.model_id === model.name,
      ),
      size: Number.isSafeInteger(model.size) ? BigInt(model.size) : undefined,
      modifiedAt: Number.isNaN(modified.getTime())
        ? undefined
        : timestampFromDate(modified),
      digest: model.digest,
      configured: true,
      inputCapabilities: [
        InputCapability.TEXT,
        ...(capabilities.includes("vision") ? [InputCapability.IMAGE] : []),
      ],
      supportsTools: capabilities.includes("tools"),
      reasoning: reasoning(ollamaReasoning(capabilities, model.details.family)),
    });
  });
}

async function openRouterModels(owner: string, cached: boolean) {
  const hasSelections = listOpenRouterModels().some(
    (model) => model.enabled === 1,
  );
  const hasSubscriptions = listOpenRouterPublishers().some(
    (publisher) => publisher.subscribed === 1,
  );
  if (!hasSelections && !hasSubscriptions) return [];
  const catalog = await getCatalogPreferences(false, cached);
  // Discovery may have enabled the first model for a subscribed publisher.
  const publishers = new Set(
    listOpenRouterModels()
      .filter((model) => model.enabled === 1)
      .map((model) => model.publisher_id),
  );
  return [...publishers]
    .flatMap((id) => publisherModels(catalog, id, owner))
    .filter((model) => model.enabled && model.availability !== "unavailable")
    .map((model) =>
      create(ModelSchema, {
        id: openRouterModelId(model.route),
        name: model.name,
        provider: ModelProvider.OPENROUTER,
        lab: publisherName(model.publisherId),
        route: model.route,
        publisherId: model.publisherId,
        favorite: model.favorite,
        isNew: model.isNew,
        created: timestampFromDate(new Date(model.created * 1000)),
        supportsTools: model.supportsTools,
        contextLength: model.contextLength ?? undefined,
        promptPricePerMillion: model.promptPricePerMillion ?? undefined,
        completionPricePerMillion: model.completionPricePerMillion ?? undefined,
        availability: AVAILABILITY[model.availability],
        configured: true,
        inputCapabilities: inputCapabilities(model.inputCapabilities),
        reasoning: reasoning(model.reasoning),
      }),
    );
}

async function chatgptModels(owner: string) {
  const favorites = listModelFavorites(owner);
  return (await chatGptModels(owner)).map((model) =>
    create(ModelSchema, {
      id: `chatgpt:${model.slug}`,
      name: model.display_name,
      provider: ModelProvider.CHATGPT,
      lab: "OpenAI",
      favorite: favorites.some(
        (row) => row.provider === "chatgpt" && row.model_id === model.slug,
      ),
      configured: true,
      inputCapabilities: [InputCapability.TEXT],
      supportsTools: true,
      reasoning: reasoning(model.reasoning),
    }),
  );
}

export const modelService: ServiceImpl<typeof ModelService> = {
  async listModels(request, context) {
    const owner = ownerOf(context);
    let ollama: Model[] = [];
    let ollamaError: string | undefined;
    try {
      ollama = await ollamaModels(owner);
    } catch (error) {
      ollamaError = errorMessage(error);
    }
    const openrouterConfigured = getOpenRouterApiKey().length > 0;
    const openrouter = openrouterConfigured
      ? await openRouterModels(owner, request.cachedCatalog)
      : [];
    const chatgptConfigured = chatGptStatus(owner).planEnabled;
    let chatgpt: Model[] = [];
    let chatgptError: string | undefined;
    if (chatgptConfigured) {
      try {
        chatgpt = await chatgptModels(owner);
      } catch (error) {
        chatgptError = errorMessage(error);
      }
    }
    return {
      models: [...ollama, ...openrouter, ...chatgpt],
      providers: {
        chatgpt: { configured: chatgptConfigured, error: chatgptError },
        ollama: { connected: ollamaError === undefined, error: ollamaError },
        openrouter: { configured: openrouterConfigured },
      },
    };
  },
  setFavorite(request, context) {
    const owner = ownerOf(context);
    const provider = PROVIDERS[request.provider as keyof typeof PROVIDERS];
    const modelId = request.modelId.trim();
    if (
      provider === "openrouter" &&
      (modelId.startsWith("openrouter:") ||
        !openRouterRouteSchema.safeParse(modelId).success)
    )
      throw new OperationError("INVALID_REQUEST", {
        message: "Use a raw OpenRouter route",
      });
    setModelFavorite(owner, provider, modelId, request.favorite);
    return {};
  },
};
