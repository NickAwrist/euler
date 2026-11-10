import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  type Interceptor,
  type ServiceImpl,
  createConnectRouter,
} from "@connectrpc/connect";
import {
  universalServerRequestFromFetch,
  universalServerResponseToFetch,
} from "@connectrpc/connect/protocol";
import { ModelProvider, ModelService } from "../../src/gen/euler/v1/models_pb";
import { ProviderService } from "../../src/gen/euler/v1/providers_pb";
import type { CatalogModel } from "../../src/models/openRouterModels";
import {
  POPULAR_PUBLISHERS,
  publisherName,
} from "../../src/models/openRouterPublishers";
import {
  AVAILABILITY,
  type CatalogSettings,
  inputCapabilities,
  openRouterCatalog,
} from "../../src/models/openRouterWire";

export type DemoScenario =
  | "ready"
  | "large"
  | "empty"
  | "stale"
  | "unavailable"
  | "errors"
  | "slow";
const now = Math.floor(Date.now() / 1000);
const sample = (
  route: string,
  name: string,
  age: number,
  tools = true,
  free = false,
): CatalogModel => ({
  route,
  name,
  publisherId: route.split("/")[0]!,
  description: "Demo model",
  created: now - age * 86400,
  contextLength: 128000,
  promptPricePerMillion: free ? 0 : 2,
  completionPricePerMillion: free ? 0 : 8,
  inputCapabilities: ["text", "image"],
  outputCapabilities: ["text"],
  supportsTools: tools,
});
const initialModels = [
  sample("anthropic/demo-sonnet", "Sonnet · Demo", 5),
  sample("anthropic/demo-opus", "Opus · Demo", 45),
  sample("openai/demo-reasoning", "Reasoning · Demo", 3),
  sample("openai/demo-mini", "Mini · Demo", 30),
  sample("google/demo-flash", "Flash · Demo", 2),
  sample("google/demo-chat:free", "Free chat · Demo", 12, false, true),
  sample("deepseek/demo-chat", "DeepSeek chat · Demo", 7, false),
  sample("cohere/demo-command", "Command · Demo", 1),
];
const archived = sample("openai/demo-retired", "Retired model · Demo", 90);
let scenario: DemoScenario = "ready";
let models = [...initialModels];
let knownModels = [...initialModels, archived];
let simulatedNow = now;
let fetchedAt = Date.now();
let choices = new Map<string, boolean>();
let favorites = new Set<string>();
let publishers = new Set<string>();
let subscriptions = new Map<string, number>();
let configured = true;
let nextAddition = 1;
let log: string[] = [];
let notify = () => {};

export function setDemoObserver(observer: () => void) {
  notify = observer;
}
export function demoLog() {
  return log;
}
export function resetDemo(next: DemoScenario) {
  scenario = next;
  fetchedAt = Date.now();
  simulatedNow = now;
  knownModels = [...initialModels, archived];
  models = next === "empty" ? [] : [...initialModels];
  if (next === "large") {
    models.push(
      ...Array.from({ length: 24 }, (_, index) =>
        sample(
          `anthropic/demo-extra-${index}`,
          `Additional model ${index + 1} · Demo`,
          30,
        ),
      ),
      ...Array.from({ length: 24 }, (_, index) =>
        sample(
          `publisher-${index}/demo-model`,
          `Publisher model ${index + 1}`,
          30,
        ),
      ),
    );
    knownModels = [...models, archived];
  }
  choices =
    next === "empty"
      ? new Map()
      : new Map([
          ["anthropic/demo-sonnet", true],
          ["openai/demo-reasoning", true],
          ["openai/demo-mini", false],
          [archived.route, true],
        ]);
  favorites =
    next === "empty"
      ? new Set()
      : new Set([
          "openrouter:anthropic/demo-sonnet",
          `openrouter:${archived.route}`,
          "ollama:local-model",
        ]);
  publishers = new Set(POPULAR_PUBLISHERS.map((p) => p.id));
  subscriptions = new Map();
  configured = true;
  nextAddition = 1;
  log = [`Scenario: ${next}`];
  notify();
}
function record(message: string) {
  log = [message, ...log].slice(0, 8);
  notify();
}
function freshness(): CatalogSettings["catalog"] {
  const status =
    scenario === "stale"
      ? "stale"
      : scenario === "unavailable"
        ? "unavailable"
        : "fresh";
  return {
    status,
    lastSuccessfulFetchAt:
      status === "unavailable"
        ? null
        : fetchedAt - (status === "stale" ? 3 * 3600000 : 0),
    error: status === "fresh" ? null : "Demo catalog outage",
  };
}
function publisherModels(
  id: string,
): CatalogSettings["modelsByPublisher"][string] {
  const visible =
    scenario === "unavailable"
      ? []
      : models.filter((m) => m.publisherId === id);
  const saved = knownModels.filter(
    (m, i, all) =>
      m.publisherId === id &&
      choices.has(m.route) &&
      all.findIndex((entry) => entry.route === m.route) === i &&
      !visible.some((entry) => entry.route === m.route),
  );
  return [...visible, ...saved].map((m) => ({
    ...m,
    enabled: choices.get(m.route) === true,
    favorite: favorites.has(`openrouter:${m.route}`),
    availability:
      scenario === "unavailable"
        ? ("unverified" as const)
        : models.some((entry) => entry.route === m.route)
          ? ("available" as const)
          : ("unavailable" as const),
    isNew:
      (simulatedNow - m.created) / 86400 <= 21 && m.created <= simulatedNow,
    ...(scenario === "unavailable"
      ? {
          contextLength: null,
          promptPricePerMillion: null,
          completionPricePerMillion: null,
        }
      : {}),
  }));
}
function overview() {
  return {
    catalog: freshness(),
    publishers: [...publishers].map((id) => ({
      id,
      name: publisherName(id),
      subscribed: subscriptions.has(id),
      subscribedAt: subscriptions.get(id) ?? null,
      enabledCount: publisherModels(id).filter((m) => m.enabled).length,
      recentCount:
        scenario === "unavailable"
          ? null
          : publisherModels(id).filter(
              (m) => m.isNew && m.availability === "available",
            ).length,
    })),
  };
}
function enableDiscoveredModels() {
  if (freshness().status !== "fresh") return;
  for (const model of models) {
    const since = subscriptions.get(model.publisherId);
    if (
      since !== undefined &&
      model.created > since &&
      !choices.has(model.route)
    )
      choices.set(model.route, true);
  }
}
function settingsSnapshot(): CatalogSettings {
  enableDiscoveredModels();
  const ids = new Set([...publishers, ...models.map((m) => m.publisherId)]);
  return {
    ...overview(),
    modelsByPublisher: Object.fromEntries(
      [...ids].map((id) => [id, publisherModels(id)]),
    ),
    discoveredPublishers:
      scenario === "unavailable"
        ? null
        : [...new Set(models.map((m) => m.publisherId))].map((id) => ({
            id,
            name: publisherName(id),
            tracked: publishers.has(id),
          })),
  };
}
export function addDemoModel() {
  const model = sample(
    `anthropic/demo-new-${nextAddition}`,
    `New arrival ${nextAddition} · Demo`,
    0,
  );
  nextAddition++;
  model.created = ++simulatedNow;
  knownModels = [...knownModels, model];
  models = [...models, model];
  enableDiscoveredModels();
  record("Discovered an Anthropic model; applied auto-enable preferences.");
}
export function removeDemoModel(route: string) {
  models = models.filter((m) => m.route !== route);
  record(`Removed ${route} from the catalog; preferences retained.`);
}

const demoProviders: Partial<ServiceImpl<typeof ProviderService>> = {
  getOpenRouterCatalog: () => ({
    catalog: openRouterCatalog(settingsSnapshot()),
  }),
  refreshOpenRouterCatalog() {
    if (freshness().status === "fresh") fetchedAt = Date.now();
    enableDiscoveredModels();
    record(
      freshness().status === "fresh"
        ? "Catalog refreshed; subscriptions synced."
        : "Refresh failed; saved preferences retained.",
    );
    return { catalog: openRouterCatalog(settingsSnapshot()) };
  },
  removeOpenRouterPublisher({ publisherId: id }) {
    publishers.delete(id);
    subscriptions.delete(id);
    for (const model of knownModels)
      if (model.publisherId === id && choices.has(model.route))
        choices.set(model.route, false);
    record(`Removed ${id}; favorites retained.`);
    return {};
  },
  getApiKey: () => ({
    state: { hasKey: configured, environmentManaged: false },
  }),
  setApiKey({ apiKey }) {
    configured = Boolean(apiKey.trim());
    record(configured ? "Demo key configured." : "Demo key removed.");
    return { state: { hasKey: configured, environmentManaged: false } };
  },
  setOpenRouterModelEnabled({ route, enabled }) {
    const model = models.find((entry) => entry.route === route);
    if (enabled && (!model || scenario === "unavailable"))
      throw new ConnectError(
        "Model is not available for interactive use",
        Code.InvalidArgument,
      );
    if (enabled && model) publishers.add(model.publisherId);
    choices.set(route, enabled);
    record(`${enabled ? "Enabled" : "Disabled"} ${route}`);
    return {};
  },
  trackOpenRouterPublisher({ publisherId }) {
    publishers.add(publisherId);
    record(`Tracking ${publisherId}`);
    return {};
  },
  setOpenRouterSubscription({ publisherId: id, subscribed }) {
    if (subscribed && !subscriptions.has(id))
      subscriptions.set(id, ++simulatedNow);
    if (!subscribed) subscriptions.delete(id);
    record(`${subscribed ? "Subscribed to" : "Unsubscribed from"} ${id}`);
    return {};
  },
  getOllamaHealth: () => ({ connected: true }),
  getOllamaConfig: () => ({
    config: { host: "Demo only", effectiveHost: "Demo only" },
  }),
};

const PROVIDER_KEYS: Partial<Record<ModelProvider, string>> = {
  [ModelProvider.OLLAMA]: "ollama",
  [ModelProvider.OPENROUTER]: "openrouter",
};

const demoModels: Partial<ServiceImpl<typeof ModelService>> = {
  listModels: () => ({
    models: [
      ...(scenario === "empty"
        ? []
        : [
            {
              id: "local-model",
              name: "Local model · Demo",
              provider: ModelProvider.OLLAMA,
              lab: "Ollama",
              favorite: favorites.has("ollama:local-model"),
              inputCapabilities: inputCapabilities(["text"]),
            },
          ]),
      ...(configured
        ? [...publishers]
            .flatMap(publisherModels)
            .filter((m) => m.enabled && m.availability !== "unavailable")
            .map((m) => ({
              id: `openrouter:${m.route}`,
              route: m.route,
              name: m.name,
              provider: ModelProvider.OPENROUTER,
              lab: publisherName(m.publisherId),
              publisherId: m.publisherId,
              favorite: m.favorite,
              isNew: m.isNew,
              supportsTools: m.supportsTools,
              contextLength: m.contextLength ?? undefined,
              promptPricePerMillion: m.promptPricePerMillion ?? undefined,
              completionPricePerMillion:
                m.completionPricePerMillion ?? undefined,
              availability: AVAILABILITY[m.availability],
              configured: true,
              inputCapabilities: inputCapabilities(m.inputCapabilities),
            }))
        : []),
    ],
  }),
  setFavorite({ provider, modelId, favorite }) {
    const key = `${PROVIDER_KEYS[provider]}:${modelId}`;
    if (favorite) favorites.add(key);
    else favorites.delete(key);
    record(`${favorite ? "Favorited" : "Unfavorited"} ${modelId}`);
    return {};
  },
};

/** Simulates latency, and failed saves in the errors scenario. */
const demoConditions: Interceptor = (next) => async (request) => {
  await new Promise((resolve) =>
    setTimeout(resolve, scenario === "slow" ? 1400 : 120),
  );
  const mutation =
    request.method.idempotency !==
    MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS;
  if (mutation && scenario === "errors") {
    record("Simulated save failure. No preferences changed.");
    throw new ConnectError(
      "Couldn't save change. Try again.",
      Code.Unavailable,
    );
  }
  return next(request);
};

/** Installed only in the standalone development playground. API traffic never leaves this page. */
export function installDemoApi() {
  resetDemo("ready");
  const router = createConnectRouter({ interceptors: [demoConditions] })
    .service(ProviderService, demoProviders)
    .service(ModelService, demoModels);
  const handlers = new Map(
    router.handlers.map((handler) => [
      `/api/rpc${handler.requestPath}`,
      handler,
    ]),
  );
  const originalFetch = window.fetch.bind(window);
  window.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin !== window.location.origin) return originalFetch(request);
      const handler = handlers.get(url.pathname);
      if (!handler) {
        if (!url.pathname.startsWith("/api/")) return originalFetch(request);
        return Response.json(
          {
            code: "unimplemented",
            message: `No demo handler for ${url.pathname}`,
          },
          { status: 404 },
        );
      }
      return universalServerResponseToFetch(
        await handler(universalServerRequestFromFetch(request, {})),
      );
    },
    { preconnect: originalFetch.preconnect },
  );
}
