import type { Appearance } from "../../src/schemas/userPreferences";
import { getUserPreferences, updateUserPreferences } from "./userPreferences";
export {
  appearanceSchema,
  type Appearance,
} from "../../src/schemas/userPreferences";

/** Widest the chat column grows, in pixels. */
export const CHAT_MAX_WIDTHS: Record<Appearance["chatWidth"], number> = {
  standard: 768,
  comfortable: 896,
  wide: 1152,
  full: Number.POSITIVE_INFINITY,
};

export function loadAppearance(): Appearance {
  return getUserPreferences().appearance;
}
export async function saveAppearance(
  appearance: Partial<Appearance>,
): Promise<Appearance> {
  return (await updateUserPreferences({ appearance })).appearance;
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
