import { afterAll, expect, spyOn, test } from "bun:test";
import { priceLlmUsage } from "../../src/llm/usageCost";
import {
  type CatalogModel,
  OpenRouterCatalog,
  openRouterCatalog,
} from "../../src/models/openRouterModels";

const model: CatalogModel = {
  route: "test/model",
  publisherId: "test",
  name: "Test",
  description: "",
  created: 0,
  contextLength: null,
  promptPricePerMillion: 3,
  completionPricePerMillion: 15,
  cacheReadPricePerMillion: 0.3,
  inputCapabilities: [],
  supportsTools: true,
  outputCapabilities: ["text"],
};

const get = spyOn(openRouterCatalog, "get").mockImplementation(async () => ({
  status: "fresh",
  models: [model],
  lastSuccessfulFetchAt: 0,
  error: null,
}));
afterAll(() => get.mockRestore());

test("splits the billed cost by list price and values the cache hit", async () => {
  const priced = await priceLlmUsage("openrouter:test/model", {
    promptTokens: 1_000_000,
    cachedTokens: 600_000,
    outputTokens: 100_000,
    // List prices sum to $2.88; the bill includes a 10% surcharge.
    cost: 3.168,
  });
  expect(priced.costBreakdown?.cachedInput).toBeCloseTo(0.198);
  expect(priced.costBreakdown?.uncachedInput).toBeCloseTo(1.32);
  expect(priced.costBreakdown?.output).toBeCloseTo(1.65);
  expect(priced.cacheSavings).toBeCloseTo(1.62);
});

test("cached counts above the prompt are clamped", async () => {
  const priced = await priceLlmUsage("openrouter:test/model", {
    promptTokens: 10,
    cachedTokens: 100,
    outputTokens: 0,
    cost: 0.000003,
  });
  expect(priced.cachedTokens).toBe(10);
  expect(priced.costBreakdown?.uncachedInput).toBe(0);
  expect(priced.cacheSavings).toBeCloseTo(0.000027);
});

test("unpriced and unbilled calls have no breakdown", async () => {
  const metrics = { promptTokens: 10, cachedTokens: 0, outputTokens: 5 };
  expect(
    await priceLlmUsage("openrouter:other/model", { ...metrics, cost: 1 }),
  ).toEqual({ cachedTokens: 0, cacheSavings: 0 });
  expect(
    await priceLlmUsage("openrouter:test/model", { ...metrics, cost: 0 }),
  ).toEqual({ cachedTokens: 0, cacheSavings: 0 });
  expect(await priceLlmUsage("llama3", { promptTokens: 10, cost: 0 })).toEqual(
    {},
  );
});

test("loads pricing for a billed call when the catalog is cold", async () => {
  let requests = 0;
  const catalog = new OpenRouterCatalog(async () => {
    requests++;
    return Response.json({
      data: [
        {
          id: model.route,
          name: model.name,
          created: 0,
          pricing: {
            prompt: "0.000003",
            completion: "0.000015",
            input_cache_read: "0.0000003",
          },
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
        },
      ],
    });
  });
  expect(catalog.peek().models).toBeNull();
  get.mockImplementationOnce(() => catalog.get());
  const metrics = {
    promptTokens: 100,
    cachedTokens: 60,
    outputTokens: 10,
    cost: 0.000288,
  };
  const priced = await priceLlmUsage("openrouter:test/model", metrics);
  expect(requests).toBe(1);
  expect(priced.costBreakdown?.cachedInput).toBeCloseTo(0.000018, 8);
  expect(priced.costBreakdown?.uncachedInput).toBeCloseTo(0.00012, 8);
  expect(priced.costBreakdown?.output).toBeCloseTo(0.00015, 8);
  expect(priced.cacheSavings).toBeCloseTo(0.000162, 8);

  get.mockImplementationOnce(() => catalog.get());
  await priceLlmUsage("openrouter:test/model", metrics);
  expect(requests).toBe(1);
});

test("catalog failure leaves billed usage intact without inventing a split", async () => {
  const catalog = new OpenRouterCatalog(async () => {
    throw new Error("offline");
  });
  get.mockImplementationOnce(() => catalog.get());
  const metrics = {
    promptTokens: 100,
    cachedTokens: 60,
    outputTokens: 10,
    cost: 0.001,
  };
  expect(await priceLlmUsage("openrouter:test/model", metrics)).toEqual({
    cachedTokens: 60,
  });
  expect(metrics.cost).toBe(0.001);
});
