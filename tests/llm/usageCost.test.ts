import { afterAll, expect, spyOn, test } from "bun:test";
import { priceLlmUsage } from "../../src/llm/usageCost";
import {
  type CatalogModel,
  openRouterCatalog,
} from "../../src/openRouterModels";

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

const peek = spyOn(openRouterCatalog, "peek").mockImplementation(() => ({
  status: "fresh",
  models: [model],
  lastSuccessfulFetchAt: 0,
  error: null,
}));
afterAll(() => peek.mockRestore());

test("splits the billed cost by list price and values the cache hit", () => {
  const priced = priceLlmUsage("openrouter:test/model", {
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

test("cached counts above the prompt are clamped", () => {
  const priced = priceLlmUsage("openrouter:test/model", {
    promptTokens: 10,
    cachedTokens: 100,
    outputTokens: 0,
    cost: 0.000003,
  });
  expect(priced.cachedTokens).toBe(10);
  expect(priced.costBreakdown?.uncachedInput).toBe(0);
  expect(priced.cacheSavings).toBeCloseTo(0.000027);
});

test("unpriced and unbilled calls have no breakdown", () => {
  const metrics = { promptTokens: 10, cachedTokens: 0, outputTokens: 5 };
  expect(
    priceLlmUsage("openrouter:other/model", { ...metrics, cost: 1 }),
  ).toEqual({ cachedTokens: 0, cacheSavings: 0 });
  expect(
    priceLlmUsage("openrouter:test/model", { ...metrics, cost: 0 }),
  ).toEqual({ cachedTokens: 0, cacheSavings: 0 });
  expect(priceLlmUsage("llama3", { promptTokens: 10, cost: 0 })).toEqual({});
});
