import { expect, test } from "bun:test";
import { mapModelOptions } from "../../ui/hooks/run/useOllamaConnection";
import { effectiveDefaultRunModel } from "../../ui/lib/defaultModel";

const models = mapModelOptions([
  {
    id: "disabled",
    name: "Disabled",
    provider: "openrouter",
    lab: "Test",
    configured: false,
  },
  {
    id: "gone",
    name: "Gone",
    provider: "openrouter",
    lab: "Test",
    availability: "unavailable",
  },
  { id: "local", name: "Local", provider: "ollama", lab: "Ollama" },
  {
    id: "remote",
    name: "Remote",
    provider: "openrouter",
    lab: "Test",
    configured: true,
    availability: "unverified",
  },
]);

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
