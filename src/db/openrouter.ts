import type { CatalogProvider } from "../llm/types";
import {
  type CatalogModel,
  isInteractiveModel,
} from "../models/openRouterModels";
import { publisherName } from "../models/openRouterPublishers";
import { getDb } from "./connection";
import type { OpenRouterModel } from "./types";

export type OpenRouterPublisher = {
  id: string;
  name: string;
  subscribed: number;
  subscribed_at: number | null;
};
export type ModelFavorite = {
  provider: "openrouter" | "ollama" | "chatgpt" | "vercel_gateway";
  model_id: string;
};

const TABLES: Record<CatalogProvider, { publishers: string; models: string }> =
  {
    openrouter: {
      publishers: "openrouter_publishers",
      models: "openrouter_models",
    },
    vercel_gateway: {
      publishers: "vercel_gateway_publishers",
      models: "vercel_gateway_models",
    },
  };

export function listOpenRouterModels(
  provider: CatalogProvider = "openrouter",
): OpenRouterModel[] {
  const { models } = TABLES[provider];
  return getDb()
    .query(`SELECT * FROM ${models} ORDER BY name`)
    .all() as OpenRouterModel[];
}
export function getOpenRouterModelByRoute(
  route: string,
  provider: CatalogProvider = "openrouter",
): OpenRouterModel | null {
  const { models } = TABLES[provider];
  return getDb()
    .query(`SELECT * FROM ${models} WHERE route = ?`)
    .get(route) as OpenRouterModel | null;
}
export function listOpenRouterPublishers(
  provider: CatalogProvider = "openrouter",
): OpenRouterPublisher[] {
  const { publishers } = TABLES[provider];
  return getDb()
    .query(`SELECT * FROM ${publishers} WHERE tracked = 1 ORDER BY name`)
    .all() as OpenRouterPublisher[];
}
export function trackOpenRouterPublisher(
  id: string,
  provider: CatalogProvider = "openrouter",
): void {
  const { publishers } = TABLES[provider];
  getDb().run(
    `INSERT INTO ${publishers} (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET tracked = 1`,
    [id, publisherName(id)],
  );
}
export function setPublisherSubscription(
  id: string,
  subscribed: boolean,
  now = Math.floor(Date.now() / 1000),
  provider: CatalogProvider = "openrouter",
): boolean {
  const { publishers } = TABLES[provider];
  return (
    getDb()
      .query(`UPDATE ${publishers} SET
    subscribed_at = CASE WHEN ? = 1 AND subscribed = 0 THEN ? ELSE subscribed_at END,
    subscribed = ? WHERE id = ? AND tracked = 1`)
      .run(Number(subscribed), now, Number(subscribed), id).changes > 0
  );
}
export function setOpenRouterModelEnabled(
  model: Pick<CatalogModel, "route" | "publisherId" | "name" | "created">,
  enabled: boolean,
  provider: CatalogProvider = "openrouter",
): void {
  const { publishers, models } = TABLES[provider];
  getDb().transaction(() => {
    if (enabled) trackOpenRouterPublisher(model.publisherId, provider);
    else
      getDb().run(
        `INSERT OR IGNORE INTO ${publishers} (id, name) VALUES (?, ?)`,
        [model.publisherId, publisherName(model.publisherId)],
      );
    getDb().run(
      `INSERT INTO ${models} (route, publisher_id, name, enabled, catalog_created_at)
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
export function refreshRegistryMetadata(
  models: readonly CatalogModel[],
  provider: CatalogProvider = "openrouter",
): void {
  const table = TABLES[provider].models;
  getDb().transaction(() => {
    const update = getDb().prepare(
      `UPDATE ${table} SET name = ?, catalog_created_at = ? WHERE route = ?`,
    );
    for (const model of models)
      update.run(model.name, model.created, model.route);
  })();
}
/** Network work must finish before entering this transaction. Re-read subscriptions here. */
export function applyPublisherSubscriptions(
  models: readonly CatalogModel[],
  provider: CatalogProvider = "openrouter",
): void {
  const table = TABLES[provider].models;
  getDb().transaction(() => {
    const subscriptions = listOpenRouterPublishers(provider).filter(
      (publisher) => publisher.subscribed === 1,
    );
    const insert = getDb().prepare(`INSERT OR IGNORE INTO ${table}
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

export function removeOpenRouterPublisher(
  id: string,
  provider: CatalogProvider = "openrouter",
): boolean {
  const { publishers, models } = TABLES[provider];
  return getDb().transaction(() => {
    const result = getDb()
      .query(
        `UPDATE ${publishers} SET tracked = 0, subscribed = 0 WHERE id = ? AND tracked = 1`,
      )
      .run(id);
    if (!result.changes) return false;
    getDb().run(`UPDATE ${models} SET enabled = 0 WHERE publisher_id = ?`, [
      id,
    ]);
    return true;
  })();
}
