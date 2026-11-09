import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  InputCapability,
  ModelProvider,
  ModelSchema,
} from "../../src/gen/euler/v1/models_pb";
import { groupModelProviders } from "../../ui/components/modelProviders";

const model = (fields: Parameters<typeof create<typeof ModelSchema>>[1]) =>
  create(ModelSchema, { inputCapabilities: [InputCapability.TEXT], ...fields });

test("publisher grouping uses identity and sorts favorites first, then newest addition date", () => {
  const base = {
    provider: ModelProvider.OPENROUTER,
    lab: "OpenAI",
    publisherId: "openai",
  };
  const models = [
    model({
      ...base,
      id: "openrouter:openai/a",
      name: "A",
      created: timestampFromMs(300_000),
    }),
    model({
      ...base,
      id: "openrouter:openai/c",
      name: "C",
      created: timestampFromMs(200_000),
      favorite: true,
    }),
    model({
      ...base,
      lab: "Open AI",
      id: "openrouter:openai/b",
      name: "B",
      created: timestampFromMs(100_000),
      favorite: true,
    }),
  ];
  const groups = groupModelProviders(models);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.id).toBe("openrouter:openai");
  expect(groups[0]?.models.map((m) => m.name)).toEqual(["C", "B", "A"]);
});

test("unknown addition dates sort last, with alphabetical ties", () => {
  const base = { provider: ModelProvider.OLLAMA, lab: "Ollama" };
  const models = [
    model({ ...base, id: "b", name: "B" }),
    model({ ...base, id: "a", name: "A" }),
    model({ ...base, id: "c", name: "C", created: timestampFromMs(100_000) }),
  ];
  expect(groupModelProviders(models)[0]?.models.map((m) => m.name)).toEqual([
    "C",
    "A",
    "B",
  ]);
});
