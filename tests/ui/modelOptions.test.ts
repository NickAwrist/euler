import { expect, test } from "bun:test";
import { groupModelProviders } from "../../ui/components/modelProviders";
import { mapModelOptions } from "../../ui/hooks/run/useOllamaConnection";

test("model response mapping retains preferences, publisher identity and capability metadata", () => {
  const models = mapModelOptions([
    {
      id: "openrouter:openai/test",
      name: "Test",
      provider: "openrouter",
      lab: "OpenAI",
      route: "openai/test",
      publisherId: "openai",
      isNew: true,
      created: 1700000000,
      favorite: true,
      configured: true,
      supportsTools: false,
      contextLength: 128000,
      promptPricePerMillion: 0,
      completionPricePerMillion: null,
      availability: "unverified",
      inputCapabilities: ["text", "image", "future-input"],
      reasoning: {
        mandatory: false,
        defaultEnabled: true,
        supportedEfforts: ["high", "medium", "low"],
        defaultEffort: "high",
      },
    },
    {
      id: "local",
      name: "Local",
      provider: "ollama",
      lab: "Ollama",
      favorite: true,
      inputCapabilities: ["text"],
    },
    { id: "broken", provider: "unknown" },
  ]);
  expect(models).toHaveLength(2);
  expect(models[0]).toMatchObject({
    id: "openrouter:openai/test",
    publisherId: "openai",
    favorite: true,
    configured: true,
    supportsTools: false,
    contextLength: 128000,
    promptPricePerMillion: 0,
    completionPricePerMillion: null,
    availability: "unverified",
    isNew: true,
    created: 1700000000,
    inputCapabilities: ["text", "image"],
    reasoning: {
      mandatory: false,
      defaultEnabled: true,
      supportedEfforts: ["high", "medium", "low"],
      defaultEffort: "high",
    },
  });
  expect(models[1]).toMatchObject({
    id: "local",
    favorite: true,
    provider: "ollama",
  });
});

test("publisher grouping uses identity and sorts favorites first, then newest addition date", () => {
  const base = {
    provider: "openrouter",
    lab: "OpenAI",
    publisherId: "openai",
    inputCapabilities: ["text"],
  };
  const models = mapModelOptions([
    { ...base, id: "openrouter:openai/a", name: "A", created: 300 },
    {
      ...base,
      id: "openrouter:openai/c",
      name: "C",
      created: 200,
      favorite: true,
    },
    {
      ...base,
      lab: "Open AI",
      id: "openrouter:openai/b",
      name: "B",
      created: 100,
      favorite: true,
    },
  ]);
  const groups = groupModelProviders(models);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.id).toBe("openrouter:openai");
  expect(groups[0]?.models.map((m) => m.name)).toEqual(["C", "B", "A"]);
});

test("unknown addition dates sort last, with alphabetical ties", () => {
  const base = {
    provider: "ollama",
    lab: "Ollama",
    inputCapabilities: ["text"],
  };
  const models = mapModelOptions([
    { ...base, id: "b", name: "B" },
    { ...base, id: "a", name: "A" },
    { ...base, id: "c", name: "C", created: 100 },
  ]);
  expect(groupModelProviders(models)[0]?.models.map((m) => m.name)).toEqual([
    "C",
    "A",
    "B",
  ]);
});
