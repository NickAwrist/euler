import { z } from "zod";

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

export const userSettingsSchema = z.object({
  systemPrompt: z.string().max(100000).nullable().default(null),
  name: z.string().max(1000).default(""),
  preferredFormats: z.string().max(10000).default(""),
  location: z.string().max(1000).default(""),
  defaultModel: z.string().max(200).default(""),
  includeCurrentDate: z.boolean().default(true),
  showDebugButton: z.boolean().default(false),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;
export const layoutSchema = z.object({
  sidebarCollapsed: z.boolean().default(false),
  artifactWidth: z.number().finite().min(280).nullable().default(null),
  artifactState: z
    .object({
      open: z.boolean(),
      workspace: z.string(),
      path: z.string().nullable(),
    })
    .default({ open: false, workspace: "", path: null }),
});
/** Built-in agent capabilities a user can turn off, e.g. in favor of an MCP server. */
export const capabilitiesSchema = z.object({
  web: z.boolean().default(true),
  imageGeneration: z.boolean().default(true),
  shell: z.boolean().default(true),
  files: z.boolean().default(true),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export const DEFAULT_COMFYUI_NEGATIVE_PROMPT =
  "low quality, worst quality, blurry, watermark, signature, text, bad anatomy, deformed, ugly, duplicate, extra fingers, poorly drawn hands, poorly drawn face, mutation, cropped";
export const imagePreferencesSchema = z.object({
  defaultModel: z.string().max(1000).default(""),
  defaultWidth: z.number().int().min(1).max(16384).default(1440),
  defaultHeight: z.number().int().min(1).max(16384).default(1440),
  negativePrompt: z
    .string()
    .max(100000)
    .default(DEFAULT_COMFYUI_NEGATIVE_PROMPT),
});
export const userPreferencesSchema = z.object({
  image: imagePreferencesSchema.default(() => imagePreferencesSchema.parse({})),
  settings: userSettingsSchema.default(() => userSettingsSchema.parse({})),
  appearance: appearanceSchema.default(() => appearanceSchema.parse({})),
  layout: layoutSchema.default(() => layoutSchema.parse({})),
  capabilities: capabilitiesSchema.default(() => capabilitiesSchema.parse({})),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
const strictAppearanceSchema = z
  .object({
    theme: appearanceSchema.shape.theme.removeCatch(),
    font: appearanceSchema.shape.font.removeCatch(),
    chatWidth: appearanceSchema.shape.chatWidth.removeCatch(),
    codeFont: appearanceSchema.shape.codeFont.removeCatch(),
    shiftForChatList: appearanceSchema.shape.shiftForChatList.removeCatch(),
    shiftForArtifacts: appearanceSchema.shape.shiftForArtifacts.removeCatch(),
    sidebarAnimationMs: appearanceSchema.shape.sidebarAnimationMs.removeCatch(),
  })
  .strict();
export const userPreferencesPatchSchema = z
  .object({
    image: z
      .object({
        defaultModel: imagePreferencesSchema.shape.defaultModel
          .removeDefault()
          .optional(),
        defaultWidth: imagePreferencesSchema.shape.defaultWidth
          .removeDefault()
          .optional(),
        defaultHeight: imagePreferencesSchema.shape.defaultHeight
          .removeDefault()
          .optional(),
        negativePrompt: imagePreferencesSchema.shape.negativePrompt
          .removeDefault()
          .optional(),
      })
      .strict()
      .optional(),
    settings: z
      .object({
        systemPrompt: userSettingsSchema.shape.systemPrompt
          .removeDefault()
          .optional(),
        name: userSettingsSchema.shape.name.removeDefault().optional(),
        preferredFormats: userSettingsSchema.shape.preferredFormats
          .removeDefault()
          .optional(),
        location: userSettingsSchema.shape.location.removeDefault().optional(),
        defaultModel: userSettingsSchema.shape.defaultModel
          .removeDefault()
          .optional(),
        includeCurrentDate: userSettingsSchema.shape.includeCurrentDate
          .removeDefault()
          .optional(),
        showDebugButton: userSettingsSchema.shape.showDebugButton
          .removeDefault()
          .optional(),
      })
      .strict()
      .optional(),
    appearance: strictAppearanceSchema.partial().optional(),
    layout: z
      .object({
        sidebarCollapsed: layoutSchema.shape.sidebarCollapsed
          .removeDefault()
          .optional(),
        artifactWidth: layoutSchema.shape.artifactWidth
          .removeDefault()
          .optional(),
        artifactState: layoutSchema.shape.artifactState
          .removeDefault()
          .optional(),
      })
      .strict()
      .optional(),
    capabilities: z
      .object({
        web: capabilitiesSchema.shape.web.removeDefault().optional(),
        imageGeneration: capabilitiesSchema.shape.imageGeneration
          .removeDefault()
          .optional(),
        shell: capabilitiesSchema.shape.shell.removeDefault().optional(),
        files: capabilitiesSchema.shape.files.removeDefault().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>;
