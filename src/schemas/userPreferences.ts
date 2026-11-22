import { z } from "zod";
import { ToolPermissionsSchema } from "./toolPermissions";

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
/** The switch of each feature a user can turn off, e.g. in favor of an MCP server. */
const featureTogglesSchema = z.object({
  files: z.boolean().default(true),
  sandbox: z.boolean().default(true),
  web: z.boolean().default(true),
  imageGeneration: z.boolean().default(true),
  skills: z.boolean().default(true),
  subagents: z.boolean().default(true),
});
export type FeatureToggles = z.infer<typeof featureTogglesSchema>;
export const imageProviderSchema = z.enum(["", "openrouter", "vercel_gateway"]);
export type ImageProviderPreference = z.infer<typeof imageProviderSchema>;
export const imagePreferencesSchema = z.object({
  provider: imageProviderSchema.catch(""),
  model: z.string().max(200).catch(""),
});
export type ImagePreferences = z.infer<typeof imagePreferencesSchema>;
export const userPreferencesSchema = z.object({
  toolPermissions: ToolPermissionsSchema.default(() =>
    ToolPermissionsSchema.parse({}),
  ),
  image: imagePreferencesSchema.default(() => imagePreferencesSchema.parse({})),
  settings: userSettingsSchema.default(() => userSettingsSchema.parse({})),
  appearance: appearanceSchema.default(() => appearanceSchema.parse({})),
  layout: layoutSchema.default(() => layoutSchema.parse({})),
  features: featureTogglesSchema.default(() => featureTogglesSchema.parse({})),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
/** The fields a write changes; a section left out keeps its saved values. */
export type UserPreferencesPatch = {
  [Section in keyof UserPreferences]?: Partial<UserPreferences[Section]>;
};
