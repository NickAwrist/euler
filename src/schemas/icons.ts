import { z } from "zod";

/** Display metadata shared by integrations and recorded tool calls. */
export const DisplayIconSchema = z.object({
  src: z
    .string()
    .max(256 * 1024)
    .refine((src) => {
      if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(src)) return true;
      try {
        const url = new URL(src);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    }, "Unsupported icon source"),
  theme: z.enum(["light", "dark"]).optional(),
});
export type DisplayIcon = z.infer<typeof DisplayIconSchema>;
