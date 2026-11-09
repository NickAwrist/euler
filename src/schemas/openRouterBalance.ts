/** What an OpenRouter key may spend; null where the key can't read a value. */
export type OpenRouterBalance = {
  accountBalance: number | null;
  keyLimit: number | null;
  keyRemaining: number | null;
  keyLimitReset: string | null;
  keyUsage: number;
};
