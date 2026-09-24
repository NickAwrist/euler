import { Router } from "express";
import { z } from "zod";
import { getOpenRouterApiKey, setOpenRouterApiKey } from "../db/index";
import {
  getOpenRouterModelByRoute,
  listOpenRouterPublishers,
  removeOpenRouterPublisher,
  setModelFavorite,
  setOpenRouterModelEnabled,
  setPublisherSubscription,
  trackOpenRouterPublisher,
} from "../db/openrouter";
import { envConfig, getEnvironmentSettings } from "../env";
import { asyncRoute } from "../http/asyncRoute";
import { canEditEnvironmentSetting } from "../http/environmentSettings";
import { sendApiError } from "../http/errors";
import { catalogFreshness, isInteractiveModel } from "../openRouterModels";
import {
  catalogSettings,
  getCatalogPreferences,
  publisherModels,
  publisherOverview,
  savedModelMetadata,
} from "../openRouterPreferences";
import { publisherName } from "../openRouterPublishers";
import { requireUserId } from "../userIdentity";

const settingsRoutes = Router();

settingsRoutes.get("/environment", (_req, res) => {
  res.json(getEnvironmentSettings());
});

settingsRoutes.get("/openrouter", (_req, res) => {
  res.json({
    hasKey: getOpenRouterApiKey().length > 0,
    environmentManaged: Boolean(envConfig.openrouterApiKey),
  });
});

settingsRoutes.put("/openrouter", (req, res) => {
  const parsed = z
    .object({ apiKey: z.string().max(512).default("") })
    .safeParse(req.body);
  if (!parsed.success) {
    sendApiError(res, 400, "BAD_REQUEST", "apiKey must be a string");
    return;
  }
  if (
    canEditEnvironmentSetting(envConfig.openrouterApiKey, parsed.data.apiKey)
  ) {
    setOpenRouterApiKey(parsed.data.apiKey);
  }
  res.json({ ok: true, hasKey: getOpenRouterApiKey().length > 0 });
});

const routeSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(/^[^/\s]+\/[^\s]+$/);

settingsRoutes.get(
  "/openrouter/catalog",
  asyncRoute(async (_req, res) => {
    res.json(catalogSettings(await getCatalogPreferences()));
  }),
);
settingsRoutes.delete("/openrouter/publishers/:id", (req, res) => {
  if (!removeOpenRouterPublisher(req.params.id))
    return sendApiError(res, 404, "NOT_FOUND", "Publisher not found");
  res.json({ ok: true });
});
settingsRoutes.get(
  "/openrouter/publishers",
  asyncRoute(async (_req, res) => {
    res.json(publisherOverview(await getCatalogPreferences()));
  }),
);
settingsRoutes.get(
  "/openrouter/catalog/publishers",
  asyncRoute(async (_req, res) => {
    const catalog = await getCatalogPreferences();
    const tracked = new Set(
      listOpenRouterPublishers().map((publisher) => publisher.id),
    );
    res.json({
      catalog: catalogFreshness(catalog),
      publishers:
        catalog.models === null
          ? null
          : [
              ...new Set(
                catalog.models
                  .filter(isInteractiveModel)
                  .map((model) => model.publisherId),
              ),
            ]
              .map((id) => ({
                id,
                name: publisherName(id),
                tracked: tracked.has(id),
              }))
              .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }),
);
settingsRoutes.post(
  "/openrouter/publishers",
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({ publisherId: z.string().min(1).max(200) })
      .safeParse(req.body);
    if (!parsed.success)
      return sendApiError(res, 400, "BAD_REQUEST", "Invalid publisher ID");
    const catalog = await getCatalogPreferences(false, true);
    if (!catalog.models)
      return sendApiError(res, 503, "UPSTREAM_ERROR", "Catalog unavailable");
    if (
      !catalog.models.some(
        (model) =>
          model.publisherId === parsed.data.publisherId &&
          isInteractiveModel(model),
      )
    ) {
      return sendApiError(
        res,
        400,
        "BAD_REQUEST",
        "Choose a publisher from the catalog",
      );
    }
    trackOpenRouterPublisher(parsed.data.publisherId);
    res.json({ ok: true });
  }),
);
settingsRoutes.patch("/openrouter/publishers/:id/subscription", (req, res) => {
  const parsed = z.object({ subscribed: z.boolean() }).safeParse(req.body);
  if (!parsed.success)
    return sendApiError(
      res,
      400,
      "BAD_REQUEST",
      "subscribed must be a boolean",
    );
  if (!setPublisherSubscription(req.params.id, parsed.data.subscribed))
    return sendApiError(res, 404, "NOT_FOUND", "Publisher not found");
  res.json({ ok: true });
});
settingsRoutes.get(
  "/openrouter/publishers/:id/models",
  asyncRoute(async (req, res) => {
    if (
      !listOpenRouterPublishers().some(
        (publisher) => publisher.id === req.params.id,
      )
    )
      return sendApiError(res, 404, "NOT_FOUND", "Publisher not found");
    const catalog = await getCatalogPreferences();
    res.json({
      catalog: catalogFreshness(catalog),
      models: publisherModels(catalog, req.params.id as string),
    });
  }),
);
settingsRoutes.patch(
  "/openrouter/models",
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({ route: routeSchema, enabled: z.boolean() })
      .safeParse(req.body);
    if (!parsed.success)
      return sendApiError(
        res,
        400,
        "BAD_REQUEST",
        "Provide a route and enabled boolean",
      );
    const { route, enabled } = parsed.data;
    const saved = getOpenRouterModelByRoute(route);
    if (!enabled && saved) {
      setOpenRouterModelEnabled(savedModelMetadata(saved), false);
      res.json({ ok: true });
      return;
    }
    const catalog = await getCatalogPreferences(false, true);
    if (!catalog.models)
      return sendApiError(
        res,
        503,
        "UPSTREAM_ERROR",
        "Catalog unavailable. Try again before enabling a model.",
      );
    const model = catalog.models.find((entry) => entry.route === route);
    if (!model || !isInteractiveModel(model))
      return sendApiError(
        res,
        400,
        "BAD_REQUEST",
        "Model is not available for interactive use",
      );
    setOpenRouterModelEnabled(model, enabled);
    res.json({ ok: true });
  }),
);
settingsRoutes.put("/models/favorite", (req, res) => {
  const parsed = z
    .object({
      provider: z.enum(["openrouter", "ollama"]),
      modelId: z.string().trim().min(1).max(200),
      favorite: z.boolean(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return sendApiError(res, 400, "BAD_REQUEST", "Invalid model favorite");
  const { provider, modelId, favorite } = parsed.data;
  if (
    provider === "openrouter" &&
    (modelId.startsWith("openrouter:") ||
      !routeSchema.safeParse(modelId).success)
  )
    return sendApiError(res, 400, "BAD_REQUEST", "Use a raw OpenRouter route");
  setModelFavorite(provider, modelId, favorite);
  res.json({ ok: true });
});
settingsRoutes.post(
  "/openrouter/catalog/refresh",
  asyncRoute(async (_req, res) => {
    const catalog = await getCatalogPreferences(true);
    res.json(catalogSettings(catalog));
  }),
);

export default settingsRoutes;
