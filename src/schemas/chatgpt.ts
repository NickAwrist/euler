import { z } from "zod";

export const chatGptReasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const chatGptProfileSchema = z.object({
  name: z.string().trim().min(1).max(512).nullable().default(null),
  picture: z
    .url({ protocol: /^https$/ })
    .max(4096)
    .nullable()
    .default(null),
});
export const chatGptStatusSchema = chatGptProfileSchema.extend({
  connected: z.boolean(),
  email: z.string().nullable(),
  planEnabled: z.boolean(),
});
export const chatGptLoginSchema = z.object({
  authorizationUrl: z.string().url(),
});
export const chatGptDisconnectSchema = z.object({ revoked: z.boolean() });
export const chatGptCredentialSchema = chatGptProfileSchema.extend({
  clientId: z.string().min(1),
  subject: z.string().min(1),
  email: z.string().nullable(),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  idToken: z.string().min(1),
  scopes: z.array(z.string()),
  expiresAt: z.number(),
});
