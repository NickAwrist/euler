import { create } from "@bufbuild/protobuf";
import {
  Appearance_ChatWidth,
  Appearance_CodeFont,
  Appearance_Font,
  Appearance_Theme,
  type UpdatePreferencesRequest,
  type UserPreferences,
  UserPreferencesSchema,
} from "../gen/euler/v1/preferences_pb";
import { toProtoRule } from "../permissions/wire";
import type {
  Appearance,
  UserPreferences as DomainPreferences,
  UserPreferencesPatch,
} from "../schemas/userPreferences";

// User preferences as the API carries them and as they are stored. Pure, so
// the server's handlers and browser test fixtures share one conversion.

/** Pairs each domain value with its proto enum value, both ways. */
export function choices<D extends string, P extends number>(
  pairs: Record<D, P>,
) {
  const reverse = new Map(
    Object.entries(pairs).map(([key, value]) => [value as P, key as D]),
  );
  return {
    toProto: (value: D) => pairs[value],
    fromProto: (value: P | undefined) =>
      value === undefined ? undefined : reverse.get(value),
  };
}

export const themes = choices<Appearance["theme"], Appearance_Theme>({
  default: Appearance_Theme.DEFAULT,
  "one-dark": Appearance_Theme.ONE_DARK,
  dracula: Appearance_Theme.DRACULA,
  nord: Appearance_Theme.NORD,
  catppuccin: Appearance_Theme.CATPPUCCIN,
  github: Appearance_Theme.GITHUB,
});
export const fonts = choices<Appearance["font"], Appearance_Font>({
  default: Appearance_Font.DEFAULT,
  serif: Appearance_Font.SERIF,
  system: Appearance_Font.SYSTEM,
  geist: Appearance_Font.GEIST,
  "source-sans": Appearance_Font.SOURCE_SANS,
  atkinson: Appearance_Font.ATKINSON,
  opendyslexic: Appearance_Font.OPENDYSLEXIC,
});
export const chatWidths = choices<
  Appearance["chatWidth"],
  Appearance_ChatWidth
>({
  standard: Appearance_ChatWidth.STANDARD,
  comfortable: Appearance_ChatWidth.COMFORTABLE,
  wide: Appearance_ChatWidth.WIDE,
  full: Appearance_ChatWidth.FULL,
});
export const codeFonts = choices<Appearance["codeFont"], Appearance_CodeFont>({
  default: Appearance_CodeFont.DEFAULT,
  "geist-mono": Appearance_CodeFont.GEIST_MONO,
  "jetbrains-mono": Appearance_CodeFont.JETBRAINS_MONO,
  "source-code": Appearance_CodeFont.SOURCE_CODE,
});

export function preferences(value: DomainPreferences): UserPreferences {
  const { appearance, layout } = value;
  return create(UserPreferencesSchema, {
    toolPermissionRules: value.toolPermissions.rules.map(toProtoRule),
    image: value.image,
    settings: {
      ...value.settings,
      systemPrompt: value.settings.systemPrompt ?? undefined,
    },
    appearance: {
      theme: themes.toProto(appearance.theme),
      font: fonts.toProto(appearance.font),
      chatWidth: chatWidths.toProto(appearance.chatWidth),
      codeFont: codeFonts.toProto(appearance.codeFont),
      shiftForChatList: appearance.shiftForChatList,
      shiftForArtifacts: appearance.shiftForArtifacts,
      sidebarAnimationMs: appearance.sidebarAnimationMs,
    },
    layout: {
      sidebarCollapsed: layout.sidebarCollapsed,
      artifactWidth: layout.artifactWidth ?? undefined,
      artifactState: {
        open: layout.artifactState.open,
        workspace: layout.artifactState.workspace,
        path: layout.artifactState.path ?? undefined,
      },
    },
    capabilities: value.capabilities,
  });
}

/** Drops unset fields, so a patch changes only what the client sent. */
const defined = <T extends object>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], undefined> };

export function imagePatch(
  value: UpdatePreferencesRequest["image"],
): UserPreferencesPatch["image"] {
  return value
    ? defined({
        defaultModel: value.defaultModel,
        defaultWidth: value.defaultWidth,
        defaultHeight: value.defaultHeight,
        negativePrompt: value.negativePrompt,
      })
    : undefined;
}

export function preferencesPatch(
  request: UpdatePreferencesRequest,
): UserPreferencesPatch {
  const { settings, appearance, layout, capabilities } = request;
  return {
    image: imagePatch(request.image),
    settings: settings
      ? defined({
          systemPrompt:
            settings.systemPrompt === undefined
              ? undefined
              : settings.systemPrompt || null,
          name: settings.name,
          preferredFormats: settings.preferredFormats,
          location: settings.location,
          defaultModel: settings.defaultModel,
          includeCurrentDate: settings.includeCurrentDate,
          showDebugButton: settings.showDebugButton,
        })
      : undefined,
    appearance: appearance
      ? defined({
          theme: themes.fromProto(appearance.theme),
          font: fonts.fromProto(appearance.font),
          chatWidth: chatWidths.fromProto(appearance.chatWidth),
          codeFont: codeFonts.fromProto(appearance.codeFont),
          shiftForChatList: appearance.shiftForChatList,
          shiftForArtifacts: appearance.shiftForArtifacts,
          sidebarAnimationMs: appearance.sidebarAnimationMs,
        })
      : undefined,
    layout: layout
      ? defined({
          sidebarCollapsed: layout.sidebarCollapsed,
          artifactWidth:
            layout.artifactWidth === undefined
              ? undefined
              : layout.artifactWidth || null,
          artifactState: layout.artifactState && {
            open: layout.artifactState.open,
            workspace: layout.artifactState.workspace,
            path: layout.artifactState.path ?? null,
          },
        })
      : undefined,
    capabilities: capabilities
      ? defined({
          web: capabilities.web,
          imageGeneration: capabilities.imageGeneration,
          shell: capabilities.shell,
          files: capabilities.files,
          skills: capabilities.skills,
        })
      : undefined,
  };
}
