import {
  type Appearance,
  Appearance_ChatWidth,
  Appearance_CodeFont,
  Appearance_Font,
  Appearance_Theme,
} from "../../src/gen/euler/v1/preferences_pb";
import { getUserPreferences, updateUserPreferences } from "./userPreferences";

export type { Appearance };
export {
  Appearance_ChatWidth,
  Appearance_CodeFont,
  Appearance_Font,
  Appearance_Theme,
};

/** The data-theme values index.css styles. */
export const THEME_SLUGS: Record<Appearance_Theme, string> = {
  [Appearance_Theme.UNSPECIFIED]: "default",
  [Appearance_Theme.DEFAULT]: "default",
  [Appearance_Theme.ONE_DARK]: "one-dark",
  [Appearance_Theme.DRACULA]: "dracula",
  [Appearance_Theme.NORD]: "nord",
  [Appearance_Theme.CATPPUCCIN]: "catppuccin",
  [Appearance_Theme.GITHUB]: "github",
};

/** The data-font values index.css styles. */
export const FONT_SLUGS: Record<Appearance_Font, string> = {
  [Appearance_Font.UNSPECIFIED]: "default",
  [Appearance_Font.DEFAULT]: "default",
  [Appearance_Font.SERIF]: "serif",
  [Appearance_Font.SYSTEM]: "system",
  [Appearance_Font.GEIST]: "geist",
  [Appearance_Font.SOURCE_SANS]: "source-sans",
  [Appearance_Font.ATKINSON]: "atkinson",
  [Appearance_Font.OPENDYSLEXIC]: "opendyslexic",
};

/** The data-code-font values index.css styles. */
export const CODE_FONT_SLUGS: Record<Appearance_CodeFont, string> = {
  [Appearance_CodeFont.UNSPECIFIED]: "default",
  [Appearance_CodeFont.DEFAULT]: "default",
  [Appearance_CodeFont.GEIST_MONO]: "geist-mono",
  [Appearance_CodeFont.JETBRAINS_MONO]: "jetbrains-mono",
  [Appearance_CodeFont.SOURCE_CODE]: "source-code",
};

/** The chat width names forms submit. */
export const CHAT_WIDTH_SLUGS: Record<Appearance_ChatWidth, string> = {
  [Appearance_ChatWidth.UNSPECIFIED]: "standard",
  [Appearance_ChatWidth.STANDARD]: "standard",
  [Appearance_ChatWidth.COMFORTABLE]: "comfortable",
  [Appearance_ChatWidth.WIDE]: "wide",
  [Appearance_ChatWidth.FULL]: "full",
};

/** Widest the chat column grows, in pixels. */
export const CHAT_MAX_WIDTHS: Record<Appearance_ChatWidth, number> = {
  [Appearance_ChatWidth.UNSPECIFIED]: 768,
  [Appearance_ChatWidth.STANDARD]: 768,
  [Appearance_ChatWidth.COMFORTABLE]: 896,
  [Appearance_ChatWidth.WIDE]: 1152,
  [Appearance_ChatWidth.FULL]: Number.POSITIVE_INFINITY,
};

const known = <T extends number>(slugs: Record<T, unknown>, value: T) =>
  value in slugs ? value : (0 as T);

/** Reads choices this version doesn't offer, such as a newer server's, as defaults. */
function knownChoices(appearance: Appearance): Appearance {
  return {
    ...appearance,
    theme: known(THEME_SLUGS, appearance.theme),
    font: known(FONT_SLUGS, appearance.font),
    codeFont: known(CODE_FONT_SLUGS, appearance.codeFont),
    chatWidth: known(CHAT_WIDTH_SLUGS, appearance.chatWidth),
  };
}

export function loadAppearance(): Appearance {
  return knownChoices(getUserPreferences().appearance!);
}
export async function saveAppearance(
  appearance: Partial<Appearance>,
): Promise<Appearance> {
  const { $typeName: _type, $unknown: _unknown, ...patch } = appearance;
  return knownChoices(
    (await updateUserPreferences({ appearance: patch })).appearance!,
  );
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = THEME_SLUGS[appearance.theme];
  root.dataset.font = FONT_SLUGS[appearance.font];
  root.dataset.codeFont = CODE_FONT_SLUGS[appearance.codeFont];
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
