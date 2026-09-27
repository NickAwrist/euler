import { isIP } from "node:net";
import { z } from "zod";

export const FaviconParamsSchema = z.object({
  hostname: z
    .string()
    .toLowerCase()
    .max(253)
    .regex(
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
      "hostname must be a public domain name",
    )
    .refine((hostname) => !isIP(hostname), "hostname must not be an IP"),
});
