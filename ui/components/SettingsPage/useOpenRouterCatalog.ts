import { create } from "@bufbuild/protobuf";
import { useCallback, useEffect, useState } from "react";
import {
  ModelProvider,
  Model_Availability,
} from "../../../src/gen/euler/v1/models_pb";
import {
  type GetOpenRouterCatalogResponse,
  type OpenRouterModel,
  type OpenRouterPublisher,
  OpenRouterPublisherSchema,
  PublisherModelsSchema,
} from "../../../src/gen/euler/v1/providers_pb";
import { modelClient, providerClient } from "../../lib/rpc";

export type CatalogSettings = GetOpenRouterCatalogResponse;
export type Publisher = OpenRouterPublisher;
export type PublisherModel = OpenRouterModel;
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
  const models = (data.modelsByPublisher[id]?.models ?? []).map((model) => {
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
    const discovered = data.discoveredPublishers?.publishers.find(
      (publisher) => publisher.id === id,
    );
    if (discovered)
      publishers = [
        ...publishers,
        create(OpenRouterPublisherSchema, {
          id,
          name: discovered.name,
          subscribed: false,
          enabledCount: models.filter((model) => model.enabled).length,
          recentCount: models.filter(
            (model) =>
              model.isNew &&
              model.availability === Model_Availability.AVAILABLE,
          ).length,
        }),
      ].sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    ...data,
    publishers,
    modelsByPublisher: {
      ...data.modelsByPublisher,
      [id]: create(PublisherModelsSchema, { models }),
    },
    discoveredPublishers: data.discoveredPublishers && {
      ...data.discoveredPublishers,
      publishers: data.discoveredPublishers.publishers.map((publisher) =>
        publisher.id === id &&
        (change.kind === "remove" || change.kind === "track")
          ? { ...publisher, tracked: change.kind === "track" }
          : publisher,
      ),
    },
  };
}
async function sendChange(
  operation: PreferenceChange,
  load: () => Promise<void>,
) {
  const { publisherId } = operation;
  switch (operation.kind) {
    case "add-model":
      await providerClient.setOpenRouterModelEnabled({
        route: operation.route,
        enabled: true,
      });
      await load();
      break;
    case "enabled":
      await providerClient.setOpenRouterModelEnabled({
        route: operation.route,
        enabled: operation.value,
      });
      break;
    case "favorite":
      await modelClient.setFavorite({
        provider: ModelProvider.OPENROUTER,
        modelId: operation.route,
        favorite: operation.value,
      });
      break;
    case "subscription":
      await providerClient.setOpenRouterSubscription({
        publisherId,
        subscribed: operation.value,
      });
      break;
    case "track":
      await providerClient.trackOpenRouterPublisher({ publisherId });
      break;
    case "remove":
      await providerClient.removeOpenRouterPublisher({ publisherId });
      break;
  }
}
export function useOpenRouterCatalog(onModelsChanged: () => Promise<void>) {
  const [data, setData] = useState<CatalogSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (force = false) => {
    setError(null);
    setData(await providerClient.getOpenRouterCatalog({ refresh: force }));
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
            before.modelsByPublisher[operation.publisherId]?.models.find(
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
