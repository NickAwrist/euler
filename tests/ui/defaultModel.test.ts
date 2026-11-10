import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import {
  ModelProvider,
  ModelSchema,
  Model_Availability,
} from "../../src/gen/euler/v1/models_pb";
import { effectiveDefaultRunModel } from "../../ui/lib/defaultModel";

const models = [
  {
    id: "disabled",
    name: "Disabled",
    provider: ModelProvider.OPENROUTER,
    lab: "Test",
    configured: false,
  },
  {
    id: "gone",
    name: "Gone",
    provider: ModelProvider.OPENROUTER,
    lab: "Test",
    configured: true,
    availability: Model_Availability.UNAVAILABLE,
  },
  {
    id: "local",
    name: "Local",
    provider: ModelProvider.OLLAMA,
    lab: "Ollama",
    configured: true,
  },
  {
    id: "remote",
    name: "Remote",
    provider: ModelProvider.OPENROUTER,
    lab: "Test",
    configured: true,
    availability: Model_Availability.UNVERIFIED,
  },
].map((model) => create(ModelSchema, model));

test("new chat defaults use an available preference or the first usable model", () => {
  expect(effectiveDefaultRunModel(" remote ", models)).toBe("remote");
  for (const saved of ["", "missing", "disabled", "gone"]) {
    expect(effectiveDefaultRunModel(saved, models)).toBe("local");
  }
});

test("new chat defaults stay empty without a usable catalog", () => {
  expect(effectiveDefaultRunModel("saved", [])).toBe("");
  expect(effectiveDefaultRunModel("disabled", models.slice(0, 2))).toBe("");
});
