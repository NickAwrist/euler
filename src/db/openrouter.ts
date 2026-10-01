import { type CatalogModel, isInteractiveModel } from "../openRouterModels";
import { publisherName } from "../openRouterPublishers";
import { getDb } from "./connection";
import type { OpenRouterModel } from "./types";

export type OpenRouterPublisher = {
  id: string;
  name: string;
  subscribed: number;
  subscribed_at: number | null;
};
export type ModelFavorite = {
  provider: "openrouter" | "ollama";
  model_id: string;
};

export function listOpenRouterModels(): OpenRouterModel[] {
  return getDb()
    .query("SELECT * FROM openrouter_models ORDER BY name")
    .all() as OpenRouterModel[];
}
export function getOpenRouterModelByRoute(
  route: string,
): OpenRouterModel | null {
  return getDb()
    .query("SELECT * FROM openrouter_models WHERE route = ?")
    .get(route) as OpenRouterModel | null;
}
export function listOpenRouterPublishers(): OpenRouterPublisher[] {
  return getDb()
    .query(
      "SELECT * FROM openrouter_publishers WHERE tracked = 1 ORDER BY name",
    )
    .all() as OpenRouterPublisher[];
}
export function trackOpenRouterPublisher(id: string): void {
  getDb().run(
    "INSERT INTO openrouter_publishers (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET tracked = 1",
    [id, publisherName(id)],
  );
}
export function setPublisherSubscription(
  id: string,
  subscribed: boolean,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return (
    getDb()
      .query(`UPDATE openrouter_publishers SET
    subscribed_at = CASE WHEN ? = 1 AND subscribed = 0 THEN ? ELSE subscribed_at END,
    subscribed = ? WHERE id = ? AND tracked = 1`)
      .run(Number(subscribed), now, Number(subscribed), id).changes > 0
  );
}
export function setOpenRouterModelEnabled(
  model: Pick<CatalogModel, "route" | "publisherId" | "name" | "created">,
  enabled: boolean,
): void {
  getDb().transaction(() => {
    if (enabled) trackOpenRouterPublisher(model.publisherId);
    else
      getDb().run(
        "INSERT OR IGNORE INTO openrouter_publishers (id, name) VALUES (?, ?)",
        [model.publisherId, publisherName(model.publisherId)],
      );
    getDb().run(
      `INSERT INTO openrouter_models (route, publisher_id, name, enabled, catalog_created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(route) DO UPDATE SET
      name = excluded.name, catalog_created_at = excluded.catalog_created_at, enabled = excluded.enabled`,
      [
        model.route,
        model.publisherId,
        model.name,
        Number(enabled),
        model.created,
      ],
    );
  })();
}
export function listModelFavorites(ownerUuid: string): ModelFavorite[] {
  return getDb()
    .query(
      "SELECT provider, model_id FROM model_favorites WHERE owner_uuid = ?",
    )
    .all(ownerUuid) as ModelFavorite[];
}
export function setModelFavorite(
  ownerUuid: string,
  provider: ModelFavorite["provider"],
  modelId: string,
  favorite: boolean,
): void {
  getDb().run(
    favorite
      ? "INSERT OR IGNORE INTO model_favorites (owner_uuid, provider, model_id) VALUES (?, ?, ?)"
      : "DELETE FROM model_favorites WHERE owner_uuid = ? AND provider = ? AND model_id = ?",
    [ownerUuid, provider, modelId],
  );
}
export function refreshRegistryMetadata(models: readonly CatalogModel[]): void {
  getDb().transaction(() => {
    const update = getDb().prepare(
      "UPDATE openrouter_models SET name = ?, catalog_created_at = ? WHERE route = ?",
    );
    for (const model of models)
      update.run(model.name, model.created, model.route);
  })();
}
/** Network work must finish before entering this transaction. Re-read subscriptions here. */
export function applyPublisherSubscriptions(
  models: readonly CatalogModel[],
): void {
  getDb().transaction(() => {
    const subscriptions = listOpenRouterPublishers().filter(
      (publisher) => publisher.subscribed === 1,
    );
    const insert = getDb().prepare(`INSERT OR IGNORE INTO openrouter_models
      (route, publisher_id, name, enabled, catalog_created_at) VALUES (?, ?, ?, 1, ?)`);
    for (const publisher of subscriptions) {
      for (const model of models) {
        if (
          isInteractiveModel(model) &&
          model.publisherId === publisher.id &&
          model.created > (publisher.subscribed_at ?? Number.POSITIVE_INFINITY)
        ) {
          insert.run(model.route, model.publisherId, model.name, model.created);
        }
      }
    }
  })();
}

export function removeOpenRouterPublisher(id: string): boolean {
  return getDb().transaction(() => {
    const result = getDb()
      .query(
        "UPDATE openrouter_publishers SET tracked = 0, subscribed = 0 WHERE id = ? AND tracked = 1",
      )
      .run(id);
    if (!result.changes) return false;
    getDb().run(
      "UPDATE openrouter_models SET enabled = 0 WHERE publisher_id = ?",
      [id],
    );
    return true;
  })();
}
