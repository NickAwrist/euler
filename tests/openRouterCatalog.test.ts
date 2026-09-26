import "./setup";
import { describe, expect, test } from "bun:test";
import {
  applyPublisherSubscriptions,
  listOpenRouterModels,
  setModelFavorite,
  setOpenRouterModelEnabled,
  setPublisherSubscription,
} from "../src/db/openrouter";
import { isNewModel } from "../src/newModels";
import {
  OpenRouterCatalog,
  isInteractiveModel,
  normalizeCatalog,
} from "../src/openRouterModels";
import {
  publisherModels,
  publisherOverview,
} from "../src/openRouterPreferences";
import { getCatalogPreferences } from "../src/openRouterPreferences";

const remoteModel = {
  id: "openai/test",
  name: "OpenAI: Test",
  created: 101,
  context_length: 1000,
  top_provider: { context_length: 2000 },
  pricing: { prompt: "0", completion: "0.000003" },
  architecture: {
    input_modalities: ["text", "image", "audio", "unknown"],
    output_modalities: ["text"],
  },
  supported_parameters: ["tools"],
};
const payload = { data: [remoteModel] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("OpenRouter catalog", () => {
  test("normalizes capability and price metadata without collapsing variants", () => {
    const models = normalizeCatalog({
      data: [
        remoteModel,
        { ...remoteModel, id: "openai/test:free" },
        { ...remoteModel, id: "openai/test:batch" },
      ],
    });
    expect(models[0]).toMatchObject({
      publisherId: "openai",
      contextLength: 2000,
      promptPricePerMillion: 0,
      completionPricePerMillion: 3,
      supportsTools: true,
      inputCapabilities: ["text", "image", "audio"],
    });
    expect(models.filter(isInteractiveModel).map((m) => m.route)).toEqual([
      "openai/test",
      "openai/test:free",
    ]);
    const unknown = normalizeCatalog({
      data: [
        {
          ...remoteModel,
          top_provider: null,
          pricing: { prompt: "invalid", completion: "-1" },
        },
      ],
    })[0]!;
    expect(unknown.contextLength).toBe(1000);
    expect(unknown.promptPricePerMillion).toBeNull();
    expect(unknown.completionPricePerMillion).toBeNull();
    expect(
      isInteractiveModel({ ...unknown, outputCapabilities: ["image"] }),
    ).toBeFalse();
    expect(isNewModel(101, 100_000)).toBeFalse();
    expect(isNewModel(100, 100_000)).toBeTrue();
    expect(isNewModel(100, (100 + 22 * 86400) * 1000)).toBeFalse();

    const withReasoning = normalizeCatalog({
      data: [
        {
          ...remoteModel,
          id: "openai/o3-mini",
          reasoning: {
            mandatory: false,
            default_enabled: true,
            supported_efforts: ["high", "medium", "low"],
            default_effort: "high",
          },
        },
        {
          ...remoteModel,
          id: "deepseek/deepseek-r1",
          reasoning: {
            mandatory: true,
          },
        },
      ],
    });
    expect(withReasoning[0]?.reasoning).toEqual({
      mandatory: false,
      defaultEnabled: true,
      supportedEfforts: ["high", "medium", "low"],
      defaultEffort: "high",
    });
    expect(withReasoning[1]?.reasoning).toEqual({
      mandatory: true,
      defaultEnabled: false,
      supportedEfforts: [],
      defaultEffort: undefined,
    });
  });
  test("coalesces requests and retains the last validated snapshot on failed refresh", async () => {
    const pending = deferred<Response>();
    let calls = 0;
    let now = 1000;
    let response = () => pending.promise;
    const catalog = new OpenRouterCatalog(
      async (_url, init) => {
        calls++;
        expect(init.signal).toBeDefined();
        return response();
      },
      () => now,
    );
    const first = catalog.get();
    const second = catalog.get(true);
    expect(calls).toBe(1);
    pending.resolve(Response.json(payload));
    const result = await first;
    expect(await second).toEqual(result);
    expect(result.status).toBe("fresh");
    await catalog.get();
    expect(calls).toBe(1);
    response = async () => Response.json({ data: [{ id: "broken" }] });
    const failed = await catalog.get(true);
    expect(failed.status).toBe("stale");
    expect(failed.models).toBe(result.models);
    expect(failed.lastSuccessfulFetchAt).toBe(1000);
    expect((await catalog.get()).status).toBe("stale");
    now += 2 * 60 * 60 * 1000;
    response = async () => Response.json({ data: [] });
    expect(await catalog.get()).toMatchObject({
      status: "fresh",
      models: [],
      lastSuccessfulFetchAt: now,
    });
    expect(calls).toBe(3);
  });
  test("reading cached preferences never fetches even after the TTL expires", async () => {
    let calls = 0;
    let now = 1000;
    const catalog = new OpenRouterCatalog(
      async () => {
        calls++;
        return Response.json(payload);
      },
      () => now,
    );
    expect(catalog.peek().status).toBe("unavailable");
    expect(calls).toBe(0);
    await catalog.get();
    now += 3 * 60 * 60 * 1000;
    expect(catalog.peek()).toMatchObject({
      status: "stale",
      lastSuccessfulFetchAt: 1000,
    });
    expect(calls).toBe(1);
  });
  test("unavailable catalogs are explicit and never mark selections removed", async () => {
    const catalog = new OpenRouterCatalog(async () => {
      throw new Error("offline");
    });
    setOpenRouterModelEnabled(normalizeCatalog(payload)[0]!, true);
    setModelFavorite("openrouter", "openai/test", true);
    const result = await catalog.get();
    expect(result).toMatchObject({
      status: "unavailable",
      models: null,
      lastSuccessfulFetchAt: null,
    });
    expect(publisherModels(result, "openai")[0]).toMatchObject({
      enabled: true,
      favorite: true,
      availability: "unverified",
      inputCapabilities: ["text"],
    });
    expect(
      publisherOverview(result).publishers.find((p) => p.id === "openai")
        ?.recentCount,
    ).toBeNull();
    expect(
      publisherModels({ ...result, status: "fresh", models: [] }, "openai")[0]
        ?.availability,
    ).toBe("unavailable");
    expect(listOpenRouterModels()).toHaveLength(1);
  });
  test("stale fallback preserves last-known availability and skips subscription activation", async () => {
    let fail = false;
    const catalog = new OpenRouterCatalog(async () =>
      fail ? new Response(null, { status: 500 }) : Response.json(payload),
    );
    await catalog.get();
    fail = true;
    const result = await catalog.get(true);
    setPublisherSubscription("openai", true, 100);
    await getCatalogPreferences(false, false, catalog);
    expect(listOpenRouterModels()).toEqual([]);
    expect(publisherModels(result, "openai")[0]?.availability).toBe(
      "available",
    );
  });
  test("new catalog discoveries auto-enable only subscribed additions without a worker", async () => {
    let data = [remoteModel];
    let time = 1000;
    const catalog = new OpenRouterCatalog(
      async () => Response.json({ data }),
      () => time,
    );
    await getCatalogPreferences(false, false, catalog);
    expect(listOpenRouterModels()).toEqual([]);
    setPublisherSubscription("openai", true, 200);
    data = [
      remoteModel,
      { ...remoteModel, id: "openai/new", created: 201 },
      { ...remoteModel, id: "openai/new:batch", created: 201 },
    ];
    time += 2 * 60 * 60 * 1000;
    await getCatalogPreferences(false, false, catalog);
    expect(
      listOpenRouterModels().map((model) => [model.route, model.enabled]),
    ).toEqual([["openai/new", 1]]);
    setOpenRouterModelEnabled(normalizeCatalog({ data })[1]!, false);
    await getCatalogPreferences(false, false, catalog);
    expect(listOpenRouterModels()[0]?.enabled).toBe(0);
  });
  test("catalog discovery re-reads subscriptions after unsubscribe", async () => {
    const pending = deferred<Response>();
    let calls = 0;
    const catalog = new OpenRouterCatalog(async () => {
      calls++;
      return pending.promise;
    });
    const sync = { run: () => getCatalogPreferences(false, false, catalog) };
    setPublisherSubscription("openai", true, 100);
    const first = sync.run();
    const concurrent = sync.run();
    expect(calls).toBe(1);
    setPublisherSubscription("openai", false, 102);
    pending.resolve(Response.json(payload));
    await Promise.all([first, concurrent]);
    expect(listOpenRouterModels()).toEqual([]);
  });
  test("concurrent syncs insert once and preserve existing activation choices", async () => {
    setPublisherSubscription("openai", true, 100);
    const models = normalizeCatalog(payload);
    setOpenRouterModelEnabled(models[0]!, false);
    const catalog = new OpenRouterCatalog(async () =>
      Response.json({
        data: [remoteModel, { ...remoteModel, id: "openai/new" }],
      }),
    );
    const sync = { run: () => getCatalogPreferences(false, false, catalog) };
    await Promise.all([sync.run(), sync.run(), sync.run()]);
    expect(listOpenRouterModels()).toHaveLength(2);
    expect(
      listOpenRouterModels().find((m) => m.route === "openai/test")?.enabled,
    ).toBe(0);
    applyPublisherSubscriptions(models);
    expect(listOpenRouterModels()).toHaveLength(2);
  });
});
