import { z } from "zod";
import type { CatalogProvider } from "../llm/types";
import {
  InputCapability,
  type InputCapability as InputCapabilityValue,
  type ModelReasoning,
  parseInputCapabilities,
  parseModelReasoning,
} from "./modelCapabilities";

const TTL_MS = 2 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const ROUTE_PATTERN = /^[^/\s]+\/[^\s]+$/;
/** A raw OpenRouter route, such as `openai/gpt-4o`. */
export const openRouterRouteSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(ROUTE_PATTERN);
const RemoteModel = z.object({
  id: z.string().regex(ROUTE_PATTERN),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  created: z.number().int().nonnegative(),
  context_length: z.number().int().positive().nullish(),
  top_provider: z
    .object({ context_length: z.number().int().positive().nullish() })
    .nullish(),
  pricing: z
    .object({
      prompt: z.unknown(),
      completion: z.unknown(),
      input_cache_read: z.unknown(),
    })
    .nullish(),
  architecture: z.object({
    input_modalities: z.array(z.string()),
    output_modalities: z.array(z.string()),
  }),
  supported_parameters: z.array(z.string()).nullish(),
  reasoning: z
    .object({
      mandatory: z.boolean().nullish(),
      default_enabled: z.boolean().nullish(),
      supported_efforts: z.array(z.string()).nullish(),
      default_effort: z.string().nullish(),
    })
    .nullish(),
});
const RemoteCatalog = z.object({ data: z.array(RemoteModel) });

const VercelReasoningOption = z.object({
  type: z.string(),
  values: z.array(z.string()).optional(),
});

const VercelRemoteModel = z.object({
  id: z.string().regex(ROUTE_PATTERN),
  name: z.string().trim().min(1).optional(),
  description: z.string().nullish(),
  created: z.number().int().nonnegative().optional(),
  released: z.number().int().nonnegative().optional(),
  context_window: z.number().int().nonnegative().nullish(),
  type: z.string().optional(),
  tags: z.array(z.string()).nullish(),
  pricing: z
    .object({
      input: z.unknown(),
      output: z.unknown(),
      input_cache_read: z.unknown(),
    })
    .nullish(),
  modalities: z
    .object({
      input: z.array(z.string()).optional(),
      output: z.array(z.string()).optional(),
    })
    .nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  reasoning_options: z.array(VercelReasoningOption).nullish(),
});
const VercelRemoteCatalog = z.object({ data: z.array(VercelRemoteModel) });

export type { ModelReasoning };

export type CatalogModel = {
  route: string;
  publisherId: string;
  name: string;
  description: string;
  created: number;
  contextLength: number | null;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
  cacheReadPricePerMillion?: number | null;
  inputCapabilities: InputCapabilityValue[];
  supportsTools: boolean;
  outputCapabilities: string[];
  reasoning?: ModelReasoning | null;
};
export type CatalogFreshness = {
  status: "fresh" | "stale" | "unavailable";
  lastSuccessfulFetchAt: number | null;
  error: string | null;
};
export type CatalogResult = CatalogFreshness & {
  models: readonly CatalogModel[] | null;
};

function price(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || value === "")
    return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) &&
    number >= 0 &&
    Number.isFinite(number * 1_000_000)
    ? number * 1_000_000
    : null;
}
export function normalizeCatalog(payload: unknown): CatalogModel[] {
  const { data } = RemoteCatalog.parse(payload);
  if (new Set(data.map((model) => model.id)).size !== data.length)
    throw new Error("Duplicate catalog routes");
  return data.map((model) => ({
    route: model.id,
    publisherId: model.id.split("/")[0]!,
    name: model.name.replace(/^[^:]+:\s*/, ""),
    description: model.description ?? "",
    created: model.created,
    contextLength:
      model.top_provider?.context_length ?? model.context_length ?? null,
    promptPricePerMillion: price(model.pricing?.prompt),
    completionPricePerMillion: price(model.pricing?.completion),
    cacheReadPricePerMillion: price(model.pricing?.input_cache_read),
    inputCapabilities: parseInputCapabilities(
      model.architecture.input_modalities,
    ),
    outputCapabilities: model.architecture.output_modalities,
    supportsTools: model.supported_parameters?.includes("tools") ?? false,
    reasoning: model.reasoning
      ? parseModelReasoning({
          mandatory: model.reasoning.mandatory,
          defaultEnabled: model.reasoning.default_enabled,
          supportedEfforts: model.reasoning.supported_efforts,
          defaultEffort: model.reasoning.default_effort,
        })
      : null,
  }));
}
/** The live catalog identifies asynchronous routes with the :batch variant. */
export function isBatchRoute(route: string): boolean {
  return route.split(":").slice(1).includes("batch");
}
export function isInteractiveModel(model: CatalogModel): boolean {
  return (
    !isBatchRoute(model.route) &&
    model.inputCapabilities.includes(InputCapability.Text) &&
    model.outputCapabilities.includes("text")
  );
}
export function catalogFreshness(result: CatalogResult): CatalogFreshness {
  return {
    status: result.status,
    lastSuccessfulFetchAt: result.lastSuccessfulFetchAt,
    error: result.error,
  };
}

function parseVercelReasoning(
  options: readonly z.infer<typeof VercelReasoningOption>[] | null | undefined,
  tags: readonly string[] | null | undefined,
): ModelReasoning | null {
  const effortOption = options?.find(
    (entry) => entry.type === "effort" && entry.values?.length,
  );
  const hasToggle = options?.some((entry) => entry.type === "toggle") ?? false;
  const hasBudget =
    options?.some((entry) => entry.type === "budget_tokens") ?? false;
  const supportedEfforts = effortOption?.values ?? [];
  if (
    !hasToggle &&
    !hasBudget &&
    supportedEfforts.length === 0 &&
    !tags?.includes("reasoning")
  ) {
    return null;
  }
  const hasOff = supportedEfforts.some(
    (value) => value.toLowerCase() === "none" || value.toLowerCase() === "off",
  );
  return parseModelReasoning({
    mandatory: !hasToggle && !hasOff && supportedEfforts.length > 0,
    defaultEnabled: true,
    supportedEfforts,
  });
}

export function normalizeVercelGatewayCatalog(
  payload: unknown,
): CatalogModel[] {
  const { data } = VercelRemoteCatalog.parse(payload);
  const languageModels = data.filter((model) => model.type === "language");
  if (
    new Set(languageModels.map((model) => model.id)).size !==
    languageModels.length
  ) {
    throw new Error("Duplicate catalog routes");
  }
  return languageModels.map((model) => {
    const rawInputs = [
      ...(model.modalities?.input ?? ["text"]),
      ...(model.tags?.includes("vision") ? ["image"] : []),
    ].map((cap) => (cap.toLowerCase() === "pdf" ? "file" : cap));
    return {
      route: model.id,
      publisherId: model.id.split("/")[0]!,
      name: model.name || model.id,
      description: model.description ?? "",
      created: model.released ?? model.created ?? 0,
      contextLength:
        model.context_window && model.context_window > 0
          ? model.context_window
          : null,
      promptPricePerMillion: price(model.pricing?.input),
      completionPricePerMillion: price(model.pricing?.output),
      cacheReadPricePerMillion: price(model.pricing?.input_cache_read),
      inputCapabilities: parseInputCapabilities(rawInputs),
      outputCapabilities: model.modalities?.output ?? ["text"],
      supportsTools:
        (model.supported_parameters?.includes("tools") ||
          model.tags?.includes("tool-use")) ??
        false,
      reasoning: parseVercelReasoning(model.reasoning_options, model.tags),
    };
  });
}

export class GatewayCatalog {
  private snapshot: {
    models: readonly CatalogModel[];
    fetchedAt: number;
  } | null = null;
  private lastError: string | null = null;
  private inFlight: Promise<CatalogResult> | null = null;
  constructor(
    private readonly url: string,
    private readonly label: string,
    private readonly normalize: (payload: unknown) => CatalogModel[],
    private readonly request: (
      url: string,
      init: RequestInit,
    ) => Promise<Response> = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {}

  peek(): CatalogResult {
    return {
      models: this.snapshot?.models ?? null,
      status: !this.snapshot
        ? "unavailable"
        : this.lastError || this.now() - this.snapshot.fetchedAt >= TTL_MS
          ? "stale"
          : "fresh",
      lastSuccessfulFetchAt: this.snapshot?.fetchedAt ?? null,
      error: this.lastError,
    };
  }

  reset(): void {
    this.snapshot = null;
    this.lastError = null;
    this.inFlight = null;
  }

  async get(force = false): Promise<CatalogResult> {
    if (this.inFlight) return this.inFlight;
    if (
      !force &&
      this.snapshot &&
      this.now() - this.snapshot.fetchedAt < TTL_MS
    ) {
      return {
        models: this.snapshot.models,
        status: this.lastError ? "stale" : "fresh",
        lastSuccessfulFetchAt: this.snapshot.fetchedAt,
        error: this.lastError,
      };
    }
    this.inFlight = this.refresh();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }
  private async refresh(): Promise<CatalogResult> {
    try {
      const response = await this.request(this.url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok)
        throw new Error(
          `${this.label} catalog request failed (${response.status})`,
        );
      const models = this.normalize(await response.json());
      this.snapshot = { models, fetchedAt: this.now() };
      this.lastError = null;
      return {
        models,
        status: "fresh",
        lastSuccessfulFetchAt: this.snapshot.fetchedAt,
        error: null,
      };
    } catch {
      this.lastError = `Could not refresh the ${this.label} catalog. Try again.`;
      return {
        models: this.snapshot?.models ?? null,
        status: this.snapshot ? "stale" : "unavailable",
        lastSuccessfulFetchAt: this.snapshot?.fetchedAt ?? null,
        error: this.lastError,
      };
    }
  }
}

export class OpenRouterCatalog extends GatewayCatalog {
  constructor(
    request?: (url: string, init: RequestInit) => Promise<Response>,
    now?: () => number,
  ) {
    super(
      "https://openrouter.ai/api/v1/models",
      "OpenRouter",
      normalizeCatalog,
      request,
      now,
    );
  }
}

export class VercelGatewayCatalog extends GatewayCatalog {
  constructor(
    request?: (url: string, init: RequestInit) => Promise<Response>,
    now?: () => number,
  ) {
    super(
      "https://ai-gateway.vercel.sh/v1/models",
      "Vercel AI Gateway",
      normalizeVercelGatewayCatalog,
      request,
      now,
    );
  }
}

export const openRouterCatalog = new OpenRouterCatalog();
export const vercelGatewayCatalog = new VercelGatewayCatalog();

export function catalogForProvider(provider: CatalogProvider): GatewayCatalog {
  return provider === "vercel_gateway"
    ? vercelGatewayCatalog
    : openRouterCatalog;
}
