import { Router } from "express";
import { z } from "zod";
import {
  getBraveSearchApiKey,
  getOpenRouterApiKey,
  setBraveSearchApiKey,
  setOpenRouterApiKey,
} from "../db/index";
import {
  getOpenRouterModelByRoute,
  listOpenRouterPublishers,
  removeOpenRouterPublisher,
  setModelFavorite,
  setOpenRouterModelEnabled,
  setPublisherSubscription,
  trackOpenRouterPublisher,
} from "../db/openrouter";
import {
  getUserPreferences,
  updateUserPreferences,
} from "../db/userPreferences";
import { envConfig, getEnvironmentSettings } from "../env";
import { asyncRoute } from "../http/asyncRoute";
import { canEditEnvironmentSetting } from "../http/environmentSettings";
import { sendError, sendValidationError } from "../observability/http";
import { fetchOpenRouterBalance } from "../openRouterBalance";
import { catalogFreshness, isInteractiveModel } from "../openRouterModels";
import {
  catalogSettings,
  getCatalogPreferences,
  publisherModels,
  publisherOverview,
  savedModelMetadata,
} from "../openRouterPreferences";
import { publisherName } from "../openRouterPublishers";
import { userPreferencesPatchSchema } from "../schemas/userPreferences";
import { requireUserId } from "../userIdentity";

const settingsRoutes = Router();
settingsRoutes.get("/user", (req, res) => {
  const owner = requireUserId(req, res);
  if (!owner) return;
  res.json(getUserPreferences(owner));
});
for (const method of ["put", "patch"] as const) {
  settingsRoutes[method]("/user", (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const parsed = userPreferencesPatchSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    res.json(updateUserPreferences(owner, parsed.data, method === "put"));
  });
}

settingsRoutes.get("/environment", (_req, res) => {
  res.json(getEnvironmentSettings());
});

/** Expose whether a key exists without ever returning the key itself. */
function apiKeyRoutes(
  path: string,
  environmentKey: () => string,
  getKey: () => string,
  setKey: (key: string) => void,
) {
  settingsRoutes.get(path, (_req, res) => {
    res.json({
      hasKey: getKey().length > 0,
      environmentManaged: Boolean(environmentKey()),
    });
  });

  settingsRoutes.put(path, (req, res) => {
    const parsed = z
      .object({ apiKey: z.string().max(512).default("") })
      .safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "INVALID_REQUEST", "apiKey must be a string");
      return;
    }
    if (canEditEnvironmentSetting(environmentKey(), parsed.data.apiKey)) {
      setKey(parsed.data.apiKey);
    }
    res.json({ ok: true, hasKey: getKey().length > 0 });
  });
}

apiKeyRoutes(
  "/openrouter",
  () => envConfig.openrouterApiKey,
  getOpenRouterApiKey,
  setOpenRouterApiKey,
);
apiKeyRoutes(
  "/brave",
  () => envConfig.braveSearchApiKey,
  getBraveSearchApiKey,
  setBraveSearchApiKey,
);

settingsRoutes.get(
  "/openrouter/balance",
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

const routeSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(/^[^/\s]+\/[^\s]+$/);

settingsRoutes.get(
  "/openrouter/catalog",
  asyncRoute(async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    res.json(catalogSettings(await getCatalogPreferences(), owner));
  }),
);
settingsRoutes.delete("/openrouter/publishers/:id", (req, res) => {
  if (!removeOpenRouterPublisher(req.params.id))
    return sendError(res, "NOT_FOUND", "Publisher not found");
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
settingsRoutes.patch("/openrouter/publishers/:id/subscription", (req, res) => {
  const parsed = z.object({ subscribed: z.boolean() }).safeParse(req.body);
  if (!parsed.success)
    return sendError(res, "INVALID_REQUEST", "subscribed must be a boolean");
  if (!setPublisherSubscription(req.params.id, parsed.data.subscribed))
    return sendError(res, "NOT_FOUND", "Publisher not found");
  res.json({ ok: true });
});
settingsRoutes.get(
  "/openrouter/publishers/:id/models",
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
settingsRoutes.patch(
  "/openrouter/models",
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({ route: routeSchema, enabled: z.boolean() })
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
settingsRoutes.put("/models/favorite", (req, res) => {
  const owner = requireUserId(req, res);
  if (!owner) return;
  const parsed = z
    .object({
      provider: z.enum(["openrouter", "ollama"]),
      modelId: z.string().trim().min(1).max(200),
      favorite: z.boolean(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return sendError(res, "INVALID_REQUEST", "Invalid model favorite");
  const { provider, modelId, favorite } = parsed.data;
  if (
    provider === "openrouter" &&
    (modelId.startsWith("openrouter:") ||
      !routeSchema.safeParse(modelId).success)
  )
    return sendError(res, "INVALID_REQUEST", "Use a raw OpenRouter route");
  setModelFavorite(owner, provider, modelId, favorite);
  res.json({ ok: true });
});
settingsRoutes.post(
  "/openrouter/catalog/refresh",
  asyncRoute(async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const catalog = await getCatalogPreferences(true);
    res.json(catalogSettings(catalog, owner));
  }),
);

export default settingsRoutes;
