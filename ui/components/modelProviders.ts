import { compareModels } from "../../src/modelSort";
import type { ModelOption } from "../types";

export type ModelProvider = {
  id: string;
  name: string;
  iconUrl?: string;
  models: ModelOption[];
};

// Major AI lab icons mapped by route organization slug or normalized lab name.
export const providerIcons: Record<string, string> = {
  anthropic: "/icons/providers/claude.svg",
  openai: "/icons/providers/openai.svg",
  google: "/icons/providers/gemini.svg",
  deepseek: "/icons/providers/deepseek.svg",
  xai: "/icons/providers/xai.svg",
  "x-ai": "/icons/providers/xai.svg",
  moonshot: "/icons/providers/moonshot.svg",
  moonshotai: "/icons/providers/moonshot.svg",
  meta: "/icons/providers/meta.svg",
  "meta-llama": "/icons/providers/meta.svg",
  mistral: "/icons/providers/mistral.svg",
  mistralai: "/icons/providers/mistral.svg",
  qwen: "/icons/providers/qwen.svg",
};

export function groupModelProviders(models: ModelOption[]): ModelProvider[] {
  const groups = new Map<string, ModelProvider>();
  for (const model of models) {
    const name =
      model.provider === "ollama" ? "Ollama" : model.lab.trim() || "OpenRouter";
    const id =
      model.provider === "ollama"
        ? "ollama"
        : `openrouter:${model.publisherId ?? (model.route ?? model.id.replace(/^openrouter:/, "")).split("/")[0]}`;
    let group = groups.get(id);
    if (!group) {
      const route = model.route ?? model.id.replace(/^openrouter:/, "");
      const routeOrg =
        route.replace(/^~/, "").split("/")[0]?.toLowerCase() ?? "";
      const labKey = model.lab
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "");
      const icon =
        model.provider === "openrouter"
          ? (providerIcons[routeOrg] ?? providerIcons[labKey])
          : undefined;
      group = {
        id,
        name,
        iconUrl: model.provider === "ollama" ? "/icons/ollama.svg" : icon,
        models: [],
      };
      groups.set(id, group);
    }
    group.models.push(model);
  }
  for (const group of groups.values()) group.models.sort(compareModels);
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function modelProviderId(model: string) {
  return model.startsWith("openrouter:")
    ? model.slice(11).split("/")[0]!
    : "ollama";
}
