import { Router } from "express";
import { getOpenRouterApiKey, listOpenRouterModels } from "../db/index";
import { listModelFavorites, listOpenRouterPublishers } from "../db/openrouter";
import { asyncRoute } from "../http/asyncRoute";
import { openRouterModelId } from "../llm/index";
import { ollamaReasoning } from "../llm/ollamaProvider";
import { chatGptModels, chatGptStatus } from "../models/chatgpt";
import { InputCapability } from "../models/modelCapabilities";
import { getOllamaClient } from "../models/ollamaClient";
import {
  getCatalogPreferences,
  publisherModels,
} from "../models/openRouterPreferences";
import { publisherName } from "../models/openRouterPublishers";
import { requireUserId } from "../userIdentity";
import { errorMessage } from "../utils/errors";

const modelsRoutes = Router();

modelsRoutes.get(
  "/",
  asyncRoute(async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const favorites = listModelFavorites(owner);
    let ollamaModels: Array<Record<string, unknown>> = [];
    let ollamaError: string | null = null;
    try {
      const { models } = await getOllamaClient().list();
      const shownModels = await Promise.allSettled(
        models.map((model) => getOllamaClient().show({ model: model.name })),
      );
      ollamaModels = models.map((m, index) => {
        const shown = shownModels[index];
        const capabilities =
          shown?.status === "fulfilled" &&
          Array.isArray(shown.value.capabilities)
            ? shown.value.capabilities
            : [];
        return {
          id: m.name,
          name: m.name,
          provider: "ollama",
          favorite: favorites.some(
            (row) => row.provider === "ollama" && row.model_id === m.name,
          ),
          lab: "Ollama",
          size: m.size,
          modified_at:
            m.modified_at instanceof Date
              ? m.modified_at.toISOString()
              : String(m.modified_at),
          digest: m.digest,
          details: m.details,
          inputCapabilities: [
            InputCapability.Text,
            ...(capabilities.includes("vision") ? [InputCapability.Image] : []),
          ],
          supportsTools: capabilities.includes("tools"),
          reasoning: ollamaReasoning(capabilities, m.details.family),
        };
      });
    } catch (error) {
      ollamaError = errorMessage(error);
    }

    const openrouterConfigured = getOpenRouterApiKey().length > 0;
    const hasSelections = listOpenRouterModels().some(
      (model) => model.enabled === 1,
    );
    const hasSubscriptions = listOpenRouterPublishers().some(
      (publisher) => publisher.subscribed === 1,
    );
    const catalog =
      openrouterConfigured && (hasSelections || hasSubscriptions)
        ? await getCatalogPreferences(false, req.query.catalog === "cached")
        : null;
    // Discovery may have enabled the first model for a subscribed publisher.
    const publishers = new Set(
      listOpenRouterModels()
        .filter((model) => model.enabled === 1)
        .map((model) => model.publisher_id),
    );
    const openRouterModels = catalog
      ? [...publishers]
          .flatMap((id) => publisherModels(catalog, id, owner))
          .filter(
            (model) => model.enabled && model.availability !== "unavailable",
          )
          .map((model) => ({
            ...model,
            id: openRouterModelId(model.route),
            provider: "openrouter",
            lab: publisherName(model.publisherId),
            configured: true,
          }))
      : [];

    let chatgptError: string | null = null;
    const chatgptConfigured = chatGptStatus(owner).planEnabled;
    let chatgptModels: Array<Record<string, unknown>> = [];
    if (chatgptConfigured) {
      try {
        chatgptModels = (await chatGptModels(owner)).map((model) => ({
          id: `chatgpt:${model.slug}`,
          name: model.display_name,
          provider: "chatgpt",
          lab: "OpenAI",
          favorite: favorites.some(
            (row) => row.provider === "chatgpt" && row.model_id === model.slug,
          ),
          inputCapabilities: [InputCapability.Text],
          supportsTools: true,
          reasoning: null,
        }));
      } catch (error) {
        chatgptError = errorMessage(error);
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      models: [...ollamaModels, ...openRouterModels, ...chatgptModels],
      providers: {
        chatgpt: { configured: chatgptConfigured, error: chatgptError },
        ollama: { connected: ollamaError === null, error: ollamaError },
        openrouter: { configured: openrouterConfigured },
      },
    });
  }),
);

export default modelsRoutes;
