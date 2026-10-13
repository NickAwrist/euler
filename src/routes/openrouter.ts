import { Router } from "express";
import { z } from "zod";
import { getOpenRouterApiKey } from "../db/index";
import {
  getOpenRouterModelByRoute,
  listOpenRouterPublishers,
  removeOpenRouterPublisher,
  setOpenRouterModelEnabled,
  setPublisherSubscription,
  trackOpenRouterPublisher,
} from "../db/openrouter";
import { asyncRoute } from "../http/asyncRoute";
import { fetchOpenRouterBalance } from "../models/openRouterBalance";
import {
  catalogFreshness,
  isInteractiveModel,
  openRouterRouteSchema,
} from "../models/openRouterModels";
import {
  catalogSettings,
  discoveredPublishers,
  getCatalogPreferences,
  publisherModels,
  publisherOverview,
  savedModelMetadata,
} from "../models/openRouterPreferences";
import { sendError } from "../observability/http";
import { requireUserId } from "../userIdentity";

/** OpenRouter catalog, publisher, and balance settings. */
const openRouterRoutes = Router();
openRouterRoutes.get(
  "/balance",
  asyncRoute(async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const apiKey = getOpenRouterApiKey();
    if (!apiKey)
      return sendError(
        res,
        "INVALID_REQUEST",
        "Configure an OpenRouter API key first",
      );
    res.json(await fetchOpenRouterBalance(apiKey));
  }),
);

openRouterRoutes.get(
  "/catalog",
  asyncRoute(async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    res.json(catalogSettings(await getCatalogPreferences(), owner));
  }),
);
openRouterRoutes.delete("/publishers/:id", (req, res) => {
  if (!removeOpenRouterPublisher(req.params.id))
    return sendError(res, "NOT_FOUND", "Publisher not found");
  res.json({ ok: true });
});
openRouterRoutes.get(
  "/publishers",
  asyncRoute(async (_req, res) => {
    res.json(publisherOverview(await getCatalogPreferences()));
  }),
);
openRouterRoutes.get(
  "/catalog/publishers",
  asyncRoute(async (_req, res) => {
    const catalog = await getCatalogPreferences();
    const tracked = new Set(
      listOpenRouterPublishers().map((publisher) => publisher.id),
    );
    res.json({
      catalog: catalogFreshness(catalog),
      publishers: discoveredPublishers(catalog, tracked),
    });
  }),
);
openRouterRoutes.post(
  "/publishers",
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({ publisherId: z.string().min(1).max(200) })
      .safeParse(req.body);
    if (!parsed.success)
      return sendError(res, "INVALID_REQUEST", "Invalid publisher ID");
    const catalog = await getCatalogPreferences(false, true);
    if (!catalog.models) return sendError(res, "CATALOG_UNAVAILABLE");
    if (
      !catalog.models.some(
        (model) =>
          model.publisherId === parsed.data.publisherId &&
          isInteractiveModel(model),
      )
    ) {
      return sendError(
        res,
        "INVALID_REQUEST",
        "Choose a publisher from the catalog",
      );
    }
    trackOpenRouterPublisher(parsed.data.publisherId);
    res.json({ ok: true });
  }),
);
openRouterRoutes.patch("/publishers/:id/subscription", (req, res) => {
  const parsed = z.object({ subscribed: z.boolean() }).safeParse(req.body);
  if (!parsed.success)
    return sendError(res, "INVALID_REQUEST", "subscribed must be a boolean");
  if (!setPublisherSubscription(req.params.id, parsed.data.subscribed))
    return sendError(res, "NOT_FOUND", "Publisher not found");
  res.json({ ok: true });
});
openRouterRoutes.get(
  "/publishers/:id/models",
  asyncRoute(async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    if (
      !listOpenRouterPublishers().some(
        (publisher) => publisher.id === req.params.id,
      )
    )
      return sendError(res, "NOT_FOUND", "Publisher not found");
    const catalog = await getCatalogPreferences();
    res.json({
      catalog: catalogFreshness(catalog),
      models: publisherModels(catalog, req.params.id as string, owner),
    });
  }),
);
openRouterRoutes.patch(
  "/models",
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({ route: openRouterRouteSchema, enabled: z.boolean() })
      .safeParse(req.body);
    if (!parsed.success)
      return sendError(
        res,
        "INVALID_REQUEST",
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
    if (!catalog.models) return sendError(res, "CATALOG_UNAVAILABLE");
    const model = catalog.models.find((entry) => entry.route === route);
    if (!model || !isInteractiveModel(model))
      return sendError(
        res,
        "INVALID_REQUEST",
        "Model is not available for interactive use",
      );
    setOpenRouterModelEnabled(model, enabled);
    res.json({ ok: true });
  }),
);
openRouterRoutes.post(
  "/catalog/refresh",
  asyncRoute(async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const catalog = await getCatalogPreferences(true);
    res.json(catalogSettings(catalog, owner));
  }),
);

export default openRouterRoutes;
