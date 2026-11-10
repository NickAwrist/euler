import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { InputCapability, Model_Availability } from "../gen/euler/v1/models_pb";
import {
  CatalogFreshness_Status,
  type OpenRouterCatalogSchema,
} from "../gen/euler/v1/providers_pb";
import {
  InputCapability as DomainInputCapability,
  type ModelReasoning,
} from "./modelCapabilities";
import type { catalogSettings } from "./openRouterPreferences";

// Converts model capabilities and the OpenRouter catalog to their messages.

const INPUT_CAPABILITIES: Record<string, InputCapability> = {
  [DomainInputCapability.Text]: InputCapability.TEXT,
  [DomainInputCapability.Image]: InputCapability.IMAGE,
  [DomainInputCapability.File]: InputCapability.FILE,
  [DomainInputCapability.Audio]: InputCapability.AUDIO,
  [DomainInputCapability.Video]: InputCapability.VIDEO,
};
export const AVAILABILITY = {
  available: Model_Availability.AVAILABLE,
  unavailable: Model_Availability.UNAVAILABLE,
  unverified: Model_Availability.UNVERIFIED,
} as const;
const FRESHNESS = {
  fresh: CatalogFreshness_Status.FRESH,
  stale: CatalogFreshness_Status.STALE,
  unavailable: CatalogFreshness_Status.UNAVAILABLE,
} as const;

export const inputCapabilities = (values: readonly string[]) =>
  values.flatMap((value) => {
    const capability = INPUT_CAPABILITIES[value];
    return capability === undefined ? [] : [capability];
  });

export const reasoning = (value: ModelReasoning | null | undefined) =>
  value
    ? {
        mandatory: value.mandatory,
        defaultEnabled: value.defaultEnabled,
        supportedEfforts: value.supportedEfforts,
        defaultEffort: value.defaultEffort,
      }
    : undefined;

const optionalMillis = (value: number | null | undefined) =>
  value == null ? undefined : timestampFromMs(value);

export type CatalogSettings = ReturnType<typeof catalogSettings>;

/** Publishers, their models and the user's choices, as GetOpenRouterCatalog returns them. */
export function openRouterCatalog(
  settings: CatalogSettings,
): MessageInitShape<typeof OpenRouterCatalogSchema> {
  return {
    freshness: {
      status: FRESHNESS[settings.catalog.status],
      lastSuccessfulFetchAt: optionalMillis(
        settings.catalog.lastSuccessfulFetchAt,
      ),
      error: settings.catalog.error ?? undefined,
    },
    publishers: settings.publishers.map((publisher) => ({
      id: publisher.id,
      name: publisher.name,
      subscribed: publisher.subscribed,
      subscribedAt: optionalMillis(publisher.subscribedAt),
      enabledCount: publisher.enabledCount,
      recentCount: publisher.recentCount ?? undefined,
    })),
    modelsByPublisher: Object.fromEntries(
      Object.entries(settings.modelsByPublisher).map(([id, models]) => [
        id,
        {
          models: models.map((model) => ({
            route: model.route,
            publisherId: model.publisherId,
            name: model.name,
            description: model.description,
            created: timestampFromMs(model.created * 1000),
            contextLength: model.contextLength ?? undefined,
            promptPricePerMillion: model.promptPricePerMillion ?? undefined,
            completionPricePerMillion:
              model.completionPricePerMillion ?? undefined,
            inputCapabilities: inputCapabilities(model.inputCapabilities),
            supportsTools: model.supportsTools,
            outputCapabilities: model.outputCapabilities,
            reasoning: reasoning(model.reasoning),
            enabled: model.enabled,
            favorite: model.favorite,
            availability: AVAILABILITY[model.availability],
            isNew: model.isNew,
          })),
        },
      ]),
    ),
    discoveredPublishers: settings.discoveredPublishers
      ? { publishers: settings.discoveredPublishers }
      : undefined,
  };
}
