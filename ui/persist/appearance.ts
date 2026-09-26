import { z } from "zod";
import { safeStorage } from "../lib/safeStorage";

export const appearanceSchema = z.object({
  theme: z
    .enum(["default", "one-dark", "dracula", "nord", "catppuccin", "github"])
    .catch("default"),
  font: z
    .enum([
      "default",
      "serif",
      "system",
      "geist",
      "source-sans",
      "atkinson",
      "opendyslexic",
    ])
    .catch("default"),
  chatWidth: z
    .enum(["standard", "comfortable", "wide", "full"])
    .catch("standard"),
  codeFont: z
    .enum(["default", "geist-mono", "jetbrains-mono", "source-code"])
    .catch("default"),
  shiftForChatList: z.boolean().catch(false),
  shiftForArtifacts: z.boolean().catch(false),
  sidebarAnimationMs: z.number().int().min(0).max(600).catch(300),
});
export type Appearance = z.infer<typeof appearanceSchema>;
const STORAGE_KEY = "euler:appearance";

/** Widest the chat column grows, in pixels. */
export const CHAT_MAX_WIDTHS: Record<Appearance["chatWidth"], number> = {
  standard: 768,
  comfortable: 896,
  wide: 1152,
  full: Number.POSITIVE_INFINITY,
};

export function loadAppearance(): Appearance {
  const result = appearanceSchema.safeParse(
    safeStorage.getJSON<unknown>(STORAGE_KEY, {}),
  );
  return result.success ? result.data : appearanceSchema.parse({});
}

export function saveAppearance(appearance: Appearance): boolean {
  return safeStorage.setJSON(STORAGE_KEY, appearance);
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = appearance.theme;
  root.dataset.font = appearance.font;
  root.dataset.codeFont = appearance.codeFont;
  const chatWidth = CHAT_MAX_WIDTHS[appearance.chatWidth];
  root.style.setProperty(
    "--chat-width",
    Number.isFinite(chatWidth) ? `${chatWidth}px` : "100%",
  );
  root.style.setProperty(
    "--sidebar-duration",
    `${appearance.sidebarAnimationMs}ms`,
  );
}
