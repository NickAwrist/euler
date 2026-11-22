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
    const isVercel = model.provider === Provider.VERCEL_GATEWAY;
    const isGateway = isVercel || model.provider === Provider.OPENROUTER;
    const prefix = isVercel ? "vercel_gateway" : "openrouter";
    const route =
      model.route ?? model.id.replace(/^(openrouter|vercel_gateway):/, "");
    const name =
      model.provider === Provider.OLLAMA
        ? "Ollama"
        : model.provider === Provider.CHATGPT
          ? "ChatGPT"
          : model.lab.trim() || (isVercel ? "Vercel AI Gateway" : "OpenRouter");
    const id =
      model.provider === Provider.OLLAMA
        ? "ollama"
        : model.provider === Provider.CHATGPT
          ? "chatgpt"
          : `${prefix}:${model.publisherId ?? route.split("/")[0]}`;
    let group = groups.get(id);
    if (!group) {
      const routeOrg =
        route.replace(/^~/, "").split("/")[0]?.toLowerCase() ?? "";
      const labKey = model.lab
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "");
      const icon = isGateway
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
  const nameCounts = new Map<string, number>();
  for (const group of groups.values()) {
    nameCounts.set(group.name, (nameCounts.get(group.name) ?? 0) + 1);
  }
  for (const group of groups.values()) {
    if ((nameCounts.get(group.name) ?? 0) > 1) {
      if (group.id.startsWith("vercel_gateway:")) {
        group.name = `${group.name} (Vercel)`;
      } else if (group.id.startsWith("openrouter:")) {
        group.name = `${group.name} (OpenRouter)`;
      }
    }
    group.models.sort(compareModelOptions);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function modelProviderId(model: string) {
  if (model.startsWith("chatgpt:")) return "chatgpt";
  if (model.startsWith("openrouter:")) return model.slice(11).split("/")[0]!;
  if (model.startsWith("vercel_gateway:"))
    return model.slice(15).split("/")[0]!;
  return "ollama";
}

/** Model ID without its catalog prefix, for display. */
export function modelRoute(model: string) {
  return model.replace(/^(openrouter|vercel_gateway|chatgpt):/, "");
}
