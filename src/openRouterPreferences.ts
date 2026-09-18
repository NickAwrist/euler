import {
  applyPublisherSubscriptions,
  listModelFavorites,
  listOpenRouterModels,
  listOpenRouterPublishers,
  refreshRegistryMetadata,
} from "./db/openrouter";
import { InputCapability } from "./modelCapabilities";
import { comparePublisherModels } from "./modelSort";
import {
  type CatalogModel,
  type CatalogResult,
  catalogFreshness,
  isInteractiveModel,
  isNewModel,
  openRouterCatalog,
} from "./openRouterModels";
import { publisherName } from "./openRouterPublishers";

export async function getCatalogPreferences(
  force = false,
  cachedOnly = false,
  service = openRouterCatalog,
) {
  const catalog = cachedOnly ? service.peek() : await service.get(force);
  if (!cachedOnly && catalog.status === "fresh" && catalog.models) {
    refreshRegistryMetadata(catalog.models);
    applyPublisherSubscriptions(catalog.models);
  }
  return catalog;
}
export function publisherModels(catalog: CatalogResult, publisherId: string) {
  const registered = listOpenRouterModels().filter(
    (model) => model.publisher_id === publisherId,
  );
  const favorites = new Set(
    listModelFavorites()
      .filter((row) => row.provider === "openrouter")
      .map((row) => row.model_id),
  );
  const choices = new Map(registered.map((model) => [model.route, model]));
  const available = (catalog.models ?? []).filter(
    (model) => model.publisherId === publisherId && isInteractiveModel(model),
  );
  const availableRoutes = new Set(available.map((model) => model.route));
  const models = available.map((model) => ({
    ...model,
    enabled: choices.get(model.route)?.enabled === 1,
    favorite: favorites.has(model.route),
    availability: "available" as "available" | "unavailable" | "unverified",
    isNew: isNewModel(model.created),
  }));
  for (const saved of registered) {
    if (availableRoutes.has(saved.route)) continue;
    // Never present a saved batch route as an interactive selection.
    if (saved.route.split(":").slice(1).includes("batch")) continue;
    models.push({
      route: saved.route,
      publisherId,
      name: saved.name,
      description: "",
      created: saved.catalog_created_at,
      contextLength: null,
      promptPricePerMillion: null,
      completionPricePerMillion: null,
      inputCapabilities: [InputCapability.Text],
      outputCapabilities: ["text"],
      supportsTools: false,
      enabled: saved.enabled === 1,
      favorite: favorites.has(saved.route),
      availability: catalog.models ? "unavailable" : "unverified",
      isNew: isNewModel(saved.catalog_created_at),
      reasoning: null,
    });
  }
  return models.sort(comparePublisherModels);
}
export function publisherOverview(catalog: CatalogResult) {
  const selections = listOpenRouterModels();
  return {
    catalog: catalogFreshness(catalog),
    publishers: listOpenRouterPublishers().map((publisher) => ({
      id: publisher.id,
      name: publisher.name,
      subscribed: publisher.subscribed === 1,
      subscribedAt: publisher.subscribed_at,
      enabledCount: selections.filter(
        (model) => model.publisher_id === publisher.id && model.enabled === 1,
      ).length,
      recentCount:
        catalog.models === null
          ? null
          : catalog.models.filter(
              (model) =>
                model.publisherId === publisher.id &&
                isInteractiveModel(model) &&
                isNewModel(model.created),
            ).length,
    })),
  };
}
export function savedModelMetadata(
  model: ReturnType<typeof listOpenRouterModels>[number],
): Pick<CatalogModel, "route" | "publisherId" | "name" | "created"> {
  return {
    route: model.route,
    publisherId: model.publisher_id,
    name: model.name,
    created: model.catalog_created_at,
  };
}

export function catalogSettings(catalog: CatalogResult) {
  const overview = publisherOverview(catalog);
  const tracked = new Set(overview.publishers.map((publisher) => publisher.id));
  const ids = new Set([
    ...tracked,
    ...(catalog.models ?? [])
      .filter(isInteractiveModel)
      .map((model) => model.publisherId),
  ]);
  return {
    ...overview,
    modelsByPublisher: Object.fromEntries(
      [...ids].map((id) => [id, publisherModels(catalog, id)]),
    ),
    discoveredPublishers:
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
  };
}
