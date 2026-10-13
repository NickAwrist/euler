import { describe, expect, test } from "bun:test";
import { InputCapability } from "../../src/models/modelCapabilities";
import { groupModelProviders } from "../../ui/components/modelProviders";
import type { ModelOption } from "../../ui/types";

describe("groupModelProviders icon mapping", () => {
  const makeModel = (
    provider: "ollama" | "openrouter",
    lab: string,
    route?: string,
    name = "Test Model",
  ): ModelOption => ({
    id: `${provider}:${route ?? lab}`,
    name,
    provider,
    lab,
    route,
    inputCapabilities: [InputCapability.Text],
  });

  test("uses Claude icon for Anthropic", () => {
    const providers = groupModelProviders([
      makeModel("openrouter", "Anthropic", "anthropic/claude-3.5-sonnet"),
    ]);
    expect(providers[0]?.iconUrl).toBe("/icons/providers/claude.svg");
  });

  test("uses Gemini icon for Google", () => {
    const providers = groupModelProviders([
      makeModel("openrouter", "Google", "google/gemini-2.5-flash"),
    ]);
    expect(providers[0]?.iconUrl).toBe("/icons/providers/gemini.svg");
  });

  test("uses xAI icon for xAI routes", () => {
    const providers = groupModelProviders([
      makeModel("openrouter", "xAI", "x-ai/grok-4.5"),
    ]);
    expect(providers[0]?.iconUrl).toBe("/icons/providers/xai.svg");
  });

  test("uses Moonshot icon for Moonshot routes", () => {
    const providers = groupModelProviders([
      makeModel("openrouter", "Moonshot AI", "moonshotai/kimi-k3"),
    ]);
    expect(providers[0]?.iconUrl).toBe("/icons/providers/moonshot.svg");
  });

  test("uses dedicated icons for other major labs", () => {
    const models = [
      makeModel("openrouter", "OpenAI", "openai/gpt-5"),
      makeModel("openrouter", "DeepSeek", "deepseek/deepseek-chat"),
      makeModel("openrouter", "Meta", "meta-llama/llama-3.3-70b"),
      makeModel("openrouter", "Mistral AI", "mistralai/mistral-large"),
      makeModel("openrouter", "Qwen", "qwen/qwen-2.5-72b"),
      makeModel("ollama", "Ollama", undefined, "llama3"),
    ];
    const providers = groupModelProviders(models);
    const byName = new Map(providers.map((p) => [p.name, p.iconUrl]));

    expect(byName.get("OpenAI")).toBe("/icons/providers/openai.svg");
    expect(byName.get("DeepSeek")).toBe("/icons/providers/deepseek.svg");
    expect(byName.get("Meta")).toBe("/icons/providers/meta.svg");
    expect(byName.get("Mistral AI")).toBe("/icons/providers/mistral.svg");
    expect(byName.get("Qwen")).toBe("/icons/providers/qwen.svg");
    expect(byName.get("Ollama")).toBe("/icons/ollama.svg");
  });

  test("does not assign icon URLs to removed/irrelevant labs", () => {
    const models = [
      makeModel("openrouter", "Cohere", "cohere/command-r"),
      makeModel("openrouter", "Perplexity", "perplexity/sonar-medium"),
      makeModel("openrouter", "Inception", "inception/model-1"),
    ];
    const providers = groupModelProviders(models);
    for (const p of providers) {
      expect(p.iconUrl).toBeUndefined();
    }
  });
});
