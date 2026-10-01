import { z } from "zod";
import {
  imagePreferencesSchema,
  userPreferencesPatchSchema,
} from "./userPreferences";

/** Express query values are often `string | string[] | undefined`. */
const queryString = z.preprocess(
  (v) => (Array.isArray(v) ? v[0] : v),
  z.string().optional(),
);

export const ComfyUIConfigPutSchema = userPreferencesPatchSchema.shape.image
  .unwrap()
  .extend({ host: z.string().optional() });

export type ComfyUIConfigPut = z.infer<typeof ComfyUIConfigPutSchema>;

export const ComfyUITestBodySchema = z.object({
  host: z.string().optional(),
});

export type ComfyUITestBody = z.infer<typeof ComfyUITestBodySchema>;

export const ComfyUIViewQuerySchema = z.object({
  subfolder: queryString,
  type: z.preprocess((v) => {
    const x = Array.isArray(v) ? v[0] : v;
    return x === undefined || x === "" ? "output" : x;
  }, z.string()),
});

export type ComfyUIViewQuery = z.infer<typeof ComfyUIViewQuerySchema>;

export const ComfyUIConfigResponseSchema = imagePreferencesSchema.extend({
  host: z.string().default(""),
  effectiveHost: z.string().default(""),
});
export type ComfyUIConfigResponse = z.infer<typeof ComfyUIConfigResponseSchema>;
