import type { CatalogModel } from "../../src/openRouterModels";
import {
  POPULAR_PUBLISHERS,
  publisherName,
} from "../../src/openRouterPublishers";

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
function freshness() {
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
function publisherModels(id: string) {
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
        ? "unverified"
        : models.some((entry) => entry.route === m.route)
          ? "available"
          : "unavailable",
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
function settingsSnapshot() {
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

/** Installed only in the standalone development playground. API traffic never leaves this page. */
export function installDemoApi() {
  resetDemo("ready");
  const originalFetch = window.fetch.bind(window);
  window.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      if (
        url.origin !== window.location.origin ||
        !url.pathname.startsWith("/api/")
      )
        return originalFetch(input, init);
      await new Promise((resolve) =>
        setTimeout(resolve, scenario === "slow" ? 1400 : 120),
      );
      const request = new Request(url, input instanceof Request ? input : init);
      const path = url.pathname.replace("/api/", "");
      const mutation = request.method !== "GET";
      if (mutation && scenario === "errors") {
        record("Simulated save failure. No preferences changed.");
        return Response.json(
          {
            error: {
              message: "Couldn't save change. Try again.",
            },
          },
          { status: 503 },
        );
      }
      const body =
        mutation &&
        request.headers.get("Content-Type")?.includes("application/json")
          ? ((await request.json()) as {
              route?: string;
              enabled?: boolean;
              provider?: string;
              modelId?: string;
              favorite?: boolean;
              publisherId?: string;
              subscribed?: boolean;
              apiKey?: string;
            })
          : {};
      if (path === "settings/openrouter/catalog")
        return Response.json(settingsSnapshot());
      const removal = path.match(/^settings\/openrouter\/publishers\/([^/]+)$/);
      if (request.method === "DELETE" && removal) {
        const id = decodeURIComponent(removal[1]!);
        publishers.delete(id);
        subscriptions.delete(id);
        for (const model of knownModels)
          if (model.publisherId === id && choices.has(model.route))
            choices.set(model.route, false);
        record(`Removed ${id}; favorites retained.`);
        return Response.json({ ok: true });
      }
      if (path === "settings/openrouter") {
        if (mutation) {
          configured = Boolean(body.apiKey?.trim());
          record(configured ? "Demo key configured." : "Demo key removed.");
        }
        return Response.json({ hasKey: configured });
      }
      if (path === "settings/openrouter/models" && body.route) {
        const model = models.find((entry) => entry.route === body.route);
        if (body.enabled && (!model || scenario === "unavailable"))
          return Response.json(
            {
              error: { message: "Model is not available for interactive use" },
            },
            { status: 400 },
          );
        if (body.enabled && model) publishers.add(model.publisherId);
        choices.set(body.route, body.enabled === true);
        record(`${body.enabled ? "Enabled" : "Disabled"} ${body.route}`);
        return Response.json({ ok: true });
      }
      if (path === "settings/models/favorite" && body.modelId) {
        const key = `${body.provider}:${body.modelId}`;
        if (body.favorite) favorites.add(key);
        else favorites.delete(key);
        record(
          `${body.favorite ? "Favorited" : "Unfavorited"} ${body.modelId}`,
        );
        return Response.json({ ok: true });
      }
      if (path === "settings/openrouter/catalog/publishers")
        return Response.json({
          catalog: freshness(),
          publishers:
            scenario === "unavailable"
              ? null
              : [...new Set(models.map((m) => m.publisherId))].map((id) => ({
                  id,
                  name: publisherName(id),
                  tracked: publishers.has(id),
                })),
        });
      if (path === "settings/openrouter/publishers") {
        if (body.publisherId) {
          publishers.add(body.publisherId);
          record(`Tracking ${body.publisherId}`);
        }
        return Response.json(overview());
      }
      const publisherPath = path.match(
        /^settings\/openrouter\/publishers\/([^/]+)\/(models|subscription)$/,
      );
      if (publisherPath) {
        const id = decodeURIComponent(publisherPath[1]!);
        if (publisherPath[2] === "models")
          return Response.json({
            catalog: freshness(),
            models: publisherModels(id),
          });
        if (body.subscribed && !subscriptions.has(id))
          subscriptions.set(id, ++simulatedNow);
        if (!body.subscribed) subscriptions.delete(id);
        record(
          `${body.subscribed ? "Subscribed to" : "Unsubscribed from"} ${id}`,
        );
        return Response.json({ ok: true });
      }
      if (path === "settings/openrouter/catalog/refresh") {
        if (freshness().status === "fresh") fetchedAt = Date.now();
        enableDiscoveredModels();
        record(
          freshness().status === "fresh"
            ? "Catalog refreshed; subscriptions synced."
            : "Refresh failed; saved preferences retained.",
        );
        return Response.json(settingsSnapshot());
      }
      if (path === "models")
        return Response.json({
          defaultModel: "local-model",
          models: [
            ...(scenario === "empty"
              ? []
              : [
                  {
                    id: "local-model",
                    name: "Local model · Demo",
                    provider: "ollama",
                    lab: "Ollama",
                    favorite: favorites.has("ollama:local-model"),
                    inputCapabilities: ["text"],
                  },
                ]),
            ...(configured
              ? [...publishers]
                  .flatMap(publisherModels)
                  .filter((m) => m.enabled && m.availability !== "unavailable")
                  .map((m) => ({
                    ...m,
                    id: `openrouter:${m.route}`,
                    provider: "openrouter",
                    lab: publisherName(m.publisherId),
                    configured: true,
                  }))
              : []),
          ],
        });
      if (path === "ollama/health") return Response.json({ connected: true });
      if (path === "ollama/config") return Response.json({ host: "Demo only" });
      return Response.json(
        { error: { message: `No demo handler for ${path}` } },
        { status: 404 },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
}
