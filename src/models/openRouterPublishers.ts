const PUBLISHER_NAMES: Record<string, string> = {
  "aion-labs": "AionLabs",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  google: "Google",
  meta: "Meta",
  "meta-llama": "Meta",
  mistralai: "Mistral AI",
  moonshot: "Moonshot AI",
  moonshotai: "Moonshot AI",
  openai: "OpenAI",
  qwen: "Qwen",
  xai: "xAI",
  "x-ai": "xAI",
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
