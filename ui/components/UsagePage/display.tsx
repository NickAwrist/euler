import { ProviderIcon } from "../ModelSelectBar";
import { providerIcons } from "../modelProviders";
export const number = (n: number | null) =>
  n === null
    ? "Not reported"
    : Intl.NumberFormat("en", {
        notation: "compact",
        maximumSignificantDigits: 3,
      }).format(n);
export const money = (n: number | null) =>
  n === null
    ? "Not reported"
    : Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: n > 0 && n < 0.01 ? 4 : 2,
      }).format(n);
// Colors sampled from the provider SVGs. Monochrome marks use the foreground color.
const colors: Record<string, string> = {
  anthropic: "#D97757",
  openai: "#e8e8e8",
  google: "#3186FF",
  deepseek: "#4D6BFE",
  qwen: "#6F69F7",
  mistralai: "#FF8205",
  "meta-llama": "#0081FA",
};
export function provider(model: string) {
  return model.startsWith("openrouter:")
    ? model.slice(11).split("/")[0]!
    : "ollama";
}
// Categorical slots validated for color-vision deficiency against the dark
// surface. Models past the eighth share a neutral color instead of new hues.
const seriesPalette = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];
export const seriesColor = (index: number) => seriesPalette[index] ?? "#8a8a8a";
export function ModelLabel({ model }: { model: string }) {
  const icon =
    provider(model) === "ollama"
      ? "/icons/ollama.svg"
      : providerIcons[provider(model)];
  return (
    <span className="usage-model">
      <ProviderIcon
        provider={{
          id: provider(model),
          name: provider(model),
          iconUrl: icon,
          models: [],
        }}
      />
      <span>{model.replace(/^openrouter:/, "")}</span>
    </span>
  );
}

export function providerColor(id: string) {
  return colors[id] ?? "#b4b4b4";
}
const providerNames: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  mistralai: "Mistral",
  "meta-llama": "Meta",
  "x-ai": "xAI",
  xai: "xAI",
  moonshotai: "Moonshot AI",
  ollama: "Ollama",
};
export function ProviderLabel({ provider: id }: { provider: string }) {
  const name = providerNames[id] ?? id;
  return (
    <span className="usage-model">
      <ProviderIcon
        provider={{
          id,
          name,
          iconUrl: id === "ollama" ? "/icons/ollama.svg" : providerIcons[id],
          models: [],
        }}
      />
      <span>{name}</span>
    </span>
  );
}
