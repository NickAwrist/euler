import { z } from "zod";

export const UsageSortRule = z.object({
  column: z.enum(["name", "tokens", "share", "spend", "cached", "savings"]),
  direction: z.enum(["ascending", "descending"]),
});
export type SortRule = z.infer<typeof UsageSortRule>;
export type SortColumn = SortRule["column"];
export const UsageQuery = z.object({
  days: z.coerce
    .number()
    .refine((value) => [0, 1, 7, 30, 90].includes(value))
    .default(7),
  grouping: z.enum(["model", "hour"]).default("model"),
  providers: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (typeof value === "string" ? [value] : value))
    .pipe(z.array(z.string().min(1).max(128)).max(64))
    .transform((values) => [...new Set(values)])
    .default([]),
  page: z.coerce.number().int().min(0).max(100000).default(0),
  asOf: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  sorting: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid sort rules" });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(UsageSortRule)
        .min(1)
        .max(6)
        .refine(
          (rules) =>
            new Set(rules.map((rule) => rule.column)).size === rules.length,
        ),
    )
    .default([{ column: "spend", direction: "descending" }]),
});
export type UsageQuery = z.infer<typeof UsageQuery>;
export type UsageTotals = {
  calls: number;
  tokens: number;
  input: number | null;
  output: number | null;
  cached: number | null;
  uncached: number | null;
  cost: number | null;
  savings: number | null;
  cacheHitRate: number | null;
};
export type UsageGroup = UsageTotals & {
  key: string;
  timestamp: number;
  tokenShare: number;
};
export type UsageDashboard = {
  grouping: "model" | "hour";
  asOf: number;
  totals: UsageTotals;
  models: UsageGroup[];
  providers: (UsageGroup & { modelCount: number })[];
  chart: {
    intervalMs: number;
    buckets: number[];
    series: { model: string; tokens: number[]; spend: number[] }[];
  };
  breakdown: {
    rows: UsageGroup[];
    page: number;
    pageSize: number;
    totalRows: number;
  };
};
