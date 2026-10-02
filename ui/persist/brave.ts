import { z } from "zod";
import { globalApiJson } from "../lib/api";

const settingsSchema = z.object({
  hasKey: z.boolean(),
  environmentManaged: z.boolean(),
});
export type BraveSettings = z.infer<typeof settingsSchema>;

export async function loadBraveSettings(): Promise<BraveSettings> {
  return settingsSchema.parse(
    await globalApiJson<unknown>("/api/settings/brave"),
  );
}
export async function saveBraveKey(apiKey: string) {
  return z.object({ hasKey: z.boolean() }).parse(
    await globalApiJson<unknown>("/api/settings/brave", {
      method: "PUT",
      json: { apiKey },
      errorMessage: "Could not save Brave key.",
    }),
  );
}
