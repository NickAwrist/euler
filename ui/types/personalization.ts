import type { UserSettings } from "../persist/userSettings";

export type Personalization = Pick<
  UserSettings,
  | "systemPrompt"
  | "includeCurrentDate"
  | "name"
  | "location"
  | "preferredFormats"
>;
