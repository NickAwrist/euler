const PUBLISHER_NAMES: Record<string, string> = {
  "aion-labs": "AionLabs",
  alibaba: "Alibaba",
  amazon: "Amazon",
  anthropic: "Anthropic",
  cohere: "Cohere",
  deepseek: "DeepSeek",
  google: "Google",
  meta: "Meta",
  "meta-llama": "Meta",
  minimax: "MiniMax",
  mistral: "Mistral AI",
  mistralai: "Mistral AI",
  moonshot: "Moonshot AI",
  moonshotai: "Moonshot AI",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  perplexity: "Perplexity",
  qwen: "Qwen",
  xai: "xAI",
  "x-ai": "xAI",
  zai: "Z.ai",
};

function titleCase(value: string): string {
  const initials: Record<string, string> = {
    gpt: "GPT",
    llm: "LLM",
    r1: "R1",
  };
  return value
    .split(/[-_.]+/)
    .filter(Boolean)
    .map(
      (part) =>
        initials[part.toLowerCase()] ??
        `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`,
    )
    .join(" ");
}

export function publisherName(id: string): string {
  return PUBLISHER_NAMES[id] ?? titleCase(id);
}

export const POPULAR_PUBLISHERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "meta-llama",
  "mistralai",
  "x-ai",
  "qwen",
  "moonshotai",
].map((id) => ({ id, name: publisherName(id) }));

export const POPULAR_VERCEL_PUBLISHERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "meta",
  "mistral",
  "xai",
  "alibaba",
  "moonshotai",
].map((id) => ({ id, name: publisherName(id) }));
