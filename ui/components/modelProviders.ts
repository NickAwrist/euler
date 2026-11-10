import { ModelProvider as Provider } from "../../src/gen/euler/v1/models_pb";
import { compareModels } from "../../src/models/modelSort";
import { optionalMillis } from "../lib/timestamps";
import type { ModelOption } from "../types";

/** Favorites first, then newest additions; unknown dates sort last. */
export function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return compareModels(
    { ...a, created: optionalMillis(a.created) ?? undefined },
    { ...b, created: optionalMillis(b.created) ?? undefined },
  );
}

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
  chatgpt: "/icons/providers/codex.svg",
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
      model.provider === Provider.OLLAMA
        ? "Ollama"
        : model.provider === Provider.CHATGPT
          ? "ChatGPT"
          : model.lab.trim() || "OpenRouter";
    const id =
      model.provider === Provider.OLLAMA
        ? "ollama"
        : model.provider === Provider.CHATGPT
          ? "chatgpt"
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
        model.provider === Provider.OPENROUTER
          ? (providerIcons[routeOrg] ?? providerIcons[labKey])
          : undefined;
      group = {
        id,
        name,
        iconUrl:
          model.provider === Provider.OLLAMA
            ? "/icons/ollama.svg"
            : model.provider === Provider.CHATGPT
              ? providerIcons.chatgpt
              : icon,
        models: [],
      };
      groups.set(id, group);
    }
    group.models.push(model);
  }
  for (const group of groups.values()) group.models.sort(compareModelOptions);
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function modelProviderId(model: string) {
  if (model.startsWith("chatgpt:")) return "chatgpt";
  return model.startsWith("openrouter:")
    ? model.slice(11).split("/")[0]!
    : "ollama";
}

/** Model ID without its catalog prefix, for display. */
export function modelRoute(model: string) {
  return model.replace(/^(openrouter|chatgpt):/, "");
}
