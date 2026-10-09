import { useCallback, useEffect, useState } from "react";
import type { catalogSettings } from "../../../src/openRouterPreferences";
import { modelSettingsRequest } from "../../lib/modelSettingsRequest";

export type CatalogSettings = ReturnType<typeof catalogSettings>;
export type Publisher = CatalogSettings["publishers"][number];
export type PublisherModel =
  CatalogSettings["modelsByPublisher"][string][number];
export type PreferenceChange =
  | { kind: "enabled"; publisherId: string; route: string; value: boolean }
  | { kind: "favorite"; publisherId: string; route: string; value: boolean }
  | { kind: "subscription"; publisherId: string; value: boolean }
  | { kind: "track"; publisherId: string }
  | { kind: "add-model"; publisherId: string; route: string }
  | { kind: "remove"; publisherId: string };

function applyChange(
  data: CatalogSettings,
  change: PreferenceChange,
): CatalogSettings {
  const id = change.publisherId;
  const models = (data.modelsByPublisher[id] ?? []).map((model) => {
    if (change.kind === "remove") return { ...model, enabled: false };
    if (
      (change.kind === "enabled" || change.kind === "favorite") &&
      model.route === change.route
    )
      return { ...model, [change.kind]: change.value };
    return model;
  });
  let publishers = data.publishers.map((publisher) =>
    publisher.id !== id
      ? publisher
      : {
          ...publisher,
          enabledCount: models.filter((model) => model.enabled).length,
          ...(change.kind === "subscription"
            ? { subscribed: change.value }
            : {}),
        },
  );
  if (change.kind === "remove")
    publishers = publishers.filter((publisher) => publisher.id !== id);
  if (change.kind === "track") {
    const discovered = data.discoveredPublishers?.find(
      (publisher) => publisher.id === id,
    );
    if (discovered)
      publishers = [
        ...publishers,
        {
          id,
          name: discovered.name,
          subscribed: false,
          subscribedAt: null,
          enabledCount: models.filter((model) => model.enabled).length,
          recentCount: models.filter(
            (model) => model.isNew && model.availability === "available",
          ).length,
        },
      ].sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    ...data,
    publishers,
    modelsByPublisher: { ...data.modelsByPublisher, [id]: models },
    discoveredPublishers:
      data.discoveredPublishers?.map((publisher) =>
        publisher.id === id &&
        (change.kind === "remove" || change.kind === "track")
          ? { ...publisher, tracked: change.kind === "track" }
          : publisher,
      ) ?? null,
  };
}
async function sendChange(
  operation: PreferenceChange,
  load: () => Promise<void>,
) {
  const id = encodeURIComponent(operation.publisherId);
  switch (operation.kind) {
    case "add-model":
      await modelSettingsRequest("openrouter/models", "PATCH", {
        route: operation.route,
        enabled: true,
      });
      await load();
      break;
    case "enabled":
      await modelSettingsRequest("openrouter/models", "PATCH", {
        route: operation.route,
        enabled: operation.value,
      });
      break;
    case "favorite":
      await modelSettingsRequest("models/favorite", "PUT", {
        provider: "openrouter",
        modelId: operation.route,
        favorite: operation.value,
      });
      break;
    case "subscription":
      await modelSettingsRequest(
        `openrouter/publishers/${id}/subscription`,
        "PATCH",
        { subscribed: operation.value },
      );
      break;
    case "track":
      await modelSettingsRequest("openrouter/publishers", "POST", {
        publisherId: operation.publisherId,
      });
      break;
    case "remove":
      await modelSettingsRequest(`openrouter/publishers/${id}`, "DELETE");

      break;
  }
}
export function useOpenRouterCatalog(onModelsChanged: () => Promise<void>) {
  const [data, setData] = useState<CatalogSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (force = false) => {
    setError(null);
    const result = await modelSettingsRequest<CatalogSettings>(
      force ? "openrouter/catalog/refresh" : "openrouter/catalog",
      force ? "POST" : "GET",
    );
    setData(result);
  }, []);
  useEffect(() => {
    void load()
      .then(() => {
        setLoading(false);
        return onModelsChanged();
      })
      .catch(() => setError("Could not load the catalog. Try again."))
      .finally(() => setLoading(false));
  }, [load]);
  const change = async (operation: PreferenceChange) => {
    if (!data) return;
    const before = data;
    const optimistic =
      operation.kind === "enabled" ||
      operation.kind === "favorite" ||
      operation.kind === "subscription";
    if (optimistic)
      setData((current) =>
        current ? applyChange(current, operation) : current,
      );
    await sendChange(operation, load).then(
      () => {
        if (!optimistic && operation.kind !== "add-model")
          setData((current) =>
            current ? applyChange(current, operation) : current,
          );
      },
      (cause: unknown) => {
        if (operation.kind === "enabled" || operation.kind === "favorite") {
          const previous =
            before.modelsByPublisher[operation.publisherId]?.find(
              (model) => model.route === operation.route,
            )?.[operation.kind] ?? false;
          setData((current) =>
            current
              ? applyChange(current, { ...operation, value: previous })
              : current,
          );
        } else if (operation.kind === "subscription") {
          const previous =
            before.publishers.find(
              (publisher) => publisher.id === operation.publisherId,
            )?.subscribed ?? false;
          setData((current) =>
            current
              ? applyChange(current, { ...operation, value: previous })
              : current,
          );
        }
        throw cause;
      },
    );
    if (
      operation.kind === "enabled" ||
      operation.kind === "favorite" ||
      operation.kind === "remove" ||
      operation.kind === "add-model"
    )
      await onModelsChanged();
  };
  return { data, loading, error, load, change };
}
