import { Router } from "express";
import { getOpenRouterApiKey, listOpenRouterModels } from "../db/index";
import { listModelFavorites, listOpenRouterPublishers } from "../db/openrouter";
import { asyncRoute } from "../http/asyncRoute";
import { errorMessage } from "../http/errors";
import { openRouterModelId } from "../llm/index";
import { InputCapability } from "../modelCapabilities";
import { getOllamaClient } from "../ollamaClient";
import {
  getCatalogPreferences,
  publisherModels,
} from "../openRouterPreferences";
import { publisherName } from "../openRouterPublishers";

const modelsRoutes = Router();

modelsRoutes.get(
  "/",
  asyncRoute(async (req, res) => {
    const favorites = listModelFavorites();
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
          .flatMap((id) => publisherModels(catalog, id))
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

    const models = [...ollamaModels, ...openRouterModels];
    res.json({
      defaultModel: models[0]?.id ?? null,
      models,
      providers: {
        ollama: { connected: ollamaError === null, error: ollamaError },
        openrouter: { configured: openrouterConfigured },
      },
    });
  }),
);

export default modelsRoutes;
