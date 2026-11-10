import { z } from "zod";

/** Display metadata shared by integrations and recorded tool calls. */
/** A base64 PNG, JPEG or WebP data URL, or an https URL without credentials. */
export function isSafeIconSource(src: string): boolean {
  if (src.length > 256 * 1024) return false;
  if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(src)) return true;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const DisplayIconSchema = z.object({
  src: z.string().refine(isSafeIconSource, "Unsupported icon source"),
  theme: z.enum(["light", "dark"]).optional(),
});
export type DisplayIcon = z.infer<typeof DisplayIconSchema>;
