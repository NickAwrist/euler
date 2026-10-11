import { z } from "zod";

export const openRouterBalanceSchema = z.object({
  accountBalance: z.number().nullable(),
  keyLimit: z.number().nullable(),
  keyRemaining: z.number().nullable(),
  keyLimitReset: z.string().nullable(),
  keyUsage: z.number(),
});

export type OpenRouterBalance = z.infer<typeof openRouterBalanceSchema>;
