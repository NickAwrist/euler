import type { SettingsTab } from "../../types";

export const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "ollama", label: "Ollama" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "image-generation", label: "Image Generation" },
  { id: "web-search", label: "Web Search" },
];

export const SIZE_PRESETS = [
  { label: "512x512 - Square", width: 512, height: 512 },
  { label: "512x768 - Portrait", width: 512, height: 768 },
  { label: "768x512 - Landscape", width: 768, height: 512 },
  { label: "768x768 - Square", width: 768, height: 768 },
  { label: "768x1024 - Portrait", width: 768, height: 1024 },
  { label: "1024x768 - Landscape", width: 1024, height: 768 },
  { label: "1024x1024 - Square", width: 1024, height: 1024 },
  { label: "1440x1440 - Square", width: 1440, height: 1440 },
] as const;

export function sizeKey(w: number, h: number): string {
  return `${w}x${h}`;
}

export function parseSize(key: string): { width: number; height: number } {
  const preset = SIZE_PRESETS.find((p) => sizeKey(p.width, p.height) === key);
  if (preset) return { width: preset.width, height: preset.height };
  return { width: 1440, height: 1440 };
}

export {
  hintClass,
  inputClass,
  labelClass,
  selectClass,
} from "../../styles";
