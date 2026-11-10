import { z } from "zod";

/** Express query values are often `string | string[] | undefined`. */
const queryString = z.preprocess(
  (v) => (Array.isArray(v) ? v[0] : v),
  z.string().optional(),
);

export const ComfyUIViewQuerySchema = z.object({
  subfolder: queryString,
  type: z.preprocess((v) => {
    const x = Array.isArray(v) ? v[0] : v;
    return x === undefined || x === "" ? "output" : x;
  }, z.string()),
});

export type ComfyUIViewQuery = z.infer<typeof ComfyUIViewQuerySchema>;
