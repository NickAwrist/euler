import type { SettingsTab } from "../../types";

export const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "ollama", label: "Ollama" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "vercel-gateway", label: "Vercel AI Gateway" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "image-generation", label: "Image Generation" },
  { id: "web-search", label: "Web Search" },
];

export {
  hintClass,
  inputClass,
  labelClass,
  selectClass,
} from "../../styles";
